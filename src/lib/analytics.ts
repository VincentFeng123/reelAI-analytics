import "server-only";

import { Pool, type PoolClient } from "pg";

import {
  addUtcDays,
  analyticsWindow,
  elapsedSeconds,
  median,
  percentage,
  trend,
} from "@/lib/analytics-core";
import type {
  AnalyticsJourneyStage,
  AnalyticsOverviewResponse,
  AnalyticsRangeDays,
  AnalyticsSeriesPoint,
} from "@/lib/types";

type Row = Record<string, unknown>;
type CountRow = { label: string; count: number };

const TIMING_SAMPLE_LIMIT = 10_000;
const PLAN_PRICE_CENTS = { plus: 499, pro: 1999 } as const;

const globalPool = globalThis as typeof globalThis & {
  reelAiAnalyticsPool?: Pool;
};

function databaseUrl(): string {
  const value = String(process.env.ANALYTICS_DATABASE_URL || "").trim();
  if (!value) {
    throw new Error("ANALYTICS_DATABASE_URL is not configured.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("ANALYTICS_DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("ANALYTICS_DATABASE_URL must use PostgreSQL.");
  }
  return value;
}

function pool(): Pool {
  if (!globalPool.reelAiAnalyticsPool) {
    const analyticsPool = new Pool({
      application_name: "reelai-analytics",
      connectionString: databaseUrl(),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      max: 2,
    });
    analyticsPool.on("error", () => {
      console.error("Analytics database pool lost an idle connection.");
    });
    globalPool.reelAiAnalyticsPool = analyticsPool;
  }
  return globalPool.reelAiAnalyticsPool;
}

function numberValue(value: unknown): number {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    throw new Error("An aggregate exceeded the safe numeric range.");
  }
  return parsed;
}

function stringValue(value: unknown, fallback = "unknown"): string {
  const parsed = String(value || "").trim();
  return parsed || fallback;
}

async function one(
  client: PoolClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<Row> {
  const result = await client.query(text, [...values]);
  return (result.rows[0] as Row | undefined) || {};
}

async function all(
  client: PoolClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await client.query(text, [...values]);
  return result.rows as Row[];
}

async function rangeCount(
  client: PoolClient,
  text: string,
  start: string,
  endExclusive: string,
): Promise<number> {
  return numberValue((await one(client, text, [start, endExclusive])).value);
}

function dailyValues(rows: Row[]): Map<string, number> {
  return new Map(
    rows
      .map((row) => [String(row.day || ""), numberValue(row.value)] as const)
      .filter(([day]) => Boolean(day)),
  );
}

async function growthSeries(
  client: PoolClient,
  startDate: string,
  endDate: string,
): Promise<AnalyticsSeriesPoint[]> {
  const endExclusive = addUtcDays(endDate, 1);
  const bounds = [startDate, endExclusive];
  const newAccounts = dailyValues(await all(client, `
    SELECT SUBSTRING(created_at FROM 1 FOR 10) AS day, COUNT(*) AS value
    FROM community_accounts
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY 1
  `, bounds));
  const consumedAccounts = dailyValues(await all(client, `
    SELECT usage.usage_day AS day,
           COALESCE(SUM(
             CASE WHEN usage.used_count > COALESCE(open.count, 0)
                  THEN 1 ELSE 0 END
           ), 0) AS value
    FROM daily_search_usage AS usage
    LEFT JOIN (
      SELECT account_id, usage_day, COUNT(*) AS count
      FROM search_quota_reservations
      WHERE status = 'reserved'
      GROUP BY account_id, usage_day
    ) AS open
      ON open.account_id = usage.account_id
     AND open.usage_day = usage.usage_day
    WHERE usage.usage_day >= $1 AND usage.usage_day < $2
    GROUP BY usage.usage_day
  `, bounds));
  const searches = dailyValues(await all(client, `
    SELECT usage.usage_day AS day,
           COALESCE(SUM(
             CASE WHEN usage.used_count > COALESCE(open.count, 0)
                  THEN usage.used_count - COALESCE(open.count, 0)
                  ELSE 0 END
           ), 0) AS value
    FROM daily_search_usage AS usage
    LEFT JOIN (
      SELECT account_id, usage_day, COUNT(*) AS count
      FROM search_quota_reservations
      WHERE status = 'reserved'
      GROUP BY account_id, usage_day
    ) AS open
      ON open.account_id = usage.account_id
     AND open.usage_day = usage.usage_day
    WHERE usage.usage_day >= $1 AND usage.usage_day < $2
    GROUP BY usage.usage_day
  `, bounds));
  const releasedReels = dailyValues(await all(client, `
    SELECT SUBSTRING(released_at FROM 1 FOR 10) AS day, COUNT(*) AS value
    FROM reels
    WHERE inventory_state = 'release_now'
      AND released_at >= $1 AND released_at < $2
    GROUP BY 1
  `, bounds));

  const series: AnalyticsSeriesPoint[] = [];
  for (let day = startDate; day <= endDate; day = addUtcDays(day, 1)) {
    series.push({
      date: day,
      new_accounts: newAccounts.get(day) || 0,
      consumed_search_accounts: consumedAccounts.get(day) || 0,
      consumed_searches: searches.get(day) || 0,
      released_reels: releasedReels.get(day) || 0,
    });
  }
  return series;
}

function billingEnvironment(): "Production" | "Sandbox" {
  const value = process.env.BILLING_ENTITLEMENT_ENVIRONMENT || "Production";
  if (value !== "Production" && value !== "Sandbox") {
    throw new Error(
      "BILLING_ENTITLEMENT_ENVIRONMENT must be Production or Sandbox.",
    );
  }
  return value;
}

async function subscriptionCounts(client: PoolClient, now: Date) {
  const row = await one(client, `
    WITH account_plans AS (
      SELECT account_id,
             MAX(CASE plan_code WHEN 'pro' THEN 2 WHEN 'plus' THEN 1 ELSE 0 END)
               AS entitled_rank,
             MAX(CASE WHEN status = 'active'
                      THEN CASE plan_code WHEN 'pro' THEN 2 WHEN 'plus' THEN 1 ELSE 0 END
                      ELSE 0 END) AS active_rank
      FROM billing_subscriptions
      WHERE provider = 'stripe'
        AND provider_environment = $1
        AND status IN ('active', 'trialing', 'grace_period')
        AND plan_code IN ('plus', 'pro')
        AND current_period_end > $2
      GROUP BY account_id
    )
    SELECT COUNT(*) FILTER (WHERE active_rank = 1) AS active_plus,
           COUNT(*) FILTER (WHERE active_rank = 2) AS active_pro,
           COUNT(*) FILTER (WHERE entitled_rank = 1) AS entitled_plus,
           COUNT(*) FILTER (WHERE entitled_rank = 2) AS entitled_pro
    FROM account_plans
  `, [billingEnvironment(), now.toISOString()]);
  return {
    active: {
      plus: numberValue(row.active_plus),
      pro: numberValue(row.active_pro),
    },
    entitled: {
      plus: numberValue(row.entitled_plus),
      pro: numberValue(row.entitled_pro),
    },
  };
}

async function journey(
  client: PoolClient,
  totalAccounts: number,
  activeSubscriptionAccounts: number,
): Promise<AnalyticsJourneyStage[]> {
  const searched = numberValue((await one(client, `
    SELECT COUNT(*) AS value
    FROM (
      SELECT usage.account_id
      FROM daily_search_usage AS usage
      LEFT JOIN (
        SELECT account_id, usage_day, COUNT(*) AS count
        FROM search_quota_reservations
        WHERE status = 'reserved'
        GROUP BY account_id, usage_day
      ) AS open
        ON open.account_id = usage.account_id
       AND open.usage_day = usage.usage_day
      WHERE usage.used_count > COALESCE(open.count, 0)
      GROUP BY usage.account_id
    ) AS searched_accounts
  `)).value);
  const watched = numberValue((await one(client, `
    SELECT COUNT(DISTINCT accounts.id) AS value
    FROM community_accounts AS accounts
    JOIN learner_reel_progress AS progress
      ON progress.learner_id = 'account:' || accounts.id
  `)).value);
  const returned = numberValue((await one(client, `
    SELECT COUNT(*) AS value
    FROM (
      SELECT usage.account_id
      FROM daily_search_usage AS usage
      LEFT JOIN (
        SELECT account_id, usage_day, COUNT(*) AS count
        FROM search_quota_reservations
        WHERE status = 'reserved'
        GROUP BY account_id, usage_day
      ) AS open
        ON open.account_id = usage.account_id
       AND open.usage_day = usage.usage_day
      WHERE usage.used_count > COALESCE(open.count, 0)
      GROUP BY usage.account_id
      HAVING COUNT(DISTINCT usage.usage_day) >= 2
    ) AS returning_accounts
  `)).value);
  const stages = [
    ["signed_up", "Signed up", totalAccounts],
    ["searched", "Started a search", searched],
    ["watched", "Watched a reel", watched],
    ["returned", "Returned another day", returned],
    ["active_subscription", "Active subscription", activeSubscriptionAccounts],
  ] as const;
  return stages.map(([key, label, value]) => ({
    key,
    label,
    value,
    conversion_pct: percentage(value, totalAccounts),
  }));
}

async function engagement(
  client: PoolClient,
  startDate: string,
  endExclusive: string,
): Promise<AnalyticsOverviewResponse["engagement"]> {
  const bounds = [startDate, endExclusive];
  const starts = await one(client, `
    SELECT COUNT(*) AS starts,
           COALESCE(SUM(
             CASE WHEN watched_to_end_at IS NOT NULL THEN 1 ELSE 0 END
           ), 0) AS start_cohort_completions
    FROM learner_reel_progress
    WHERE created_at >= $1 AND created_at < $2
  `, bounds);
  const completionEvents = await rangeCount(client, `
    SELECT COUNT(*) AS value
    FROM learner_reel_progress
    WHERE watched_to_end_at >= $1 AND watched_to_end_at < $2
  `, startDate, endExclusive);
  const feedback = await one(client, `
    SELECT COALESCE(SUM(CASE WHEN helpful = 1 THEN 1 ELSE 0 END), 0) AS helpful,
           COALESCE(SUM(CASE WHEN confusing = 1 THEN 1 ELSE 0 END), 0) AS confusing
    FROM reel_feedback
    WHERE mastery_updated_at >= $1 AND mastery_updated_at < $2
  `, bounds);
  const assessments = await one(client, `
    SELECT COUNT(*) AS attempts,
           COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct
    FROM assessment_attempts
    WHERE created_at >= $1 AND created_at < $2
  `, bounds);
  const reelStarts = numberValue(starts.starts);
  const cohortCompletions = numberValue(starts.start_cohort_completions);
  const helpful = numberValue(feedback.helpful);
  const confusing = numberValue(feedback.confusing);
  const attempts = numberValue(assessments.attempts);
  const correct = numberValue(assessments.correct);
  return {
    reel_starts: reelStarts,
    reel_completions: completionEvents,
    start_cohort_completions: cohortCompletions,
    start_cohort_completion_rate_pct: percentage(cohortCompletions, reelStarts),
    helpful,
    confusing,
    helpful_rate_pct: percentage(helpful, helpful + confusing),
    assessment_attempts: attempts,
    assessment_correct: correct,
    assessment_accuracy_pct: percentage(correct, attempts),
  };
}

async function pipeline(
  client: PoolClient,
  startDate: string,
  endExclusive: string,
): Promise<AnalyticsOverviewResponse["pipeline"]> {
  const bounds = [startDate, endExclusive];
  const jobs = (await all(client, `
    SELECT status, COUNT(*) AS count
    FROM reel_generation_jobs
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY status
    ORDER BY count DESC, status ASC
  `, bounds)).map((row) => ({
    status: stringValue(row.status),
    count: numberValue(row.count),
  }));
  const statusCounts = new Map(jobs.map((row) => [row.status, row.count]));
  const settled = ["completed", "partial", "exhausted"]
    .reduce((sum, status) => sum + (statusCounts.get(status) || 0), 0);
  const terminal = settled + (statusCounts.get("failed") || 0);
  const live = await one(client, `
    SELECT COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
           COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running
    FROM reel_generation_jobs
    WHERE status IN ('queued', 'running')
  `);
  const timingRows = await all(client, `
    SELECT created_at, started_at, completed_at
    FROM reel_generation_jobs
    WHERE created_at >= $1 AND created_at < $2
      AND started_at IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ${TIMING_SAMPLE_LIMIT}
  `, bounds);
  const queueTimes = timingRows
    .map((row) => elapsedSeconds(row.created_at, row.started_at))
    .filter((value): value is number => value !== null);
  const runTimes = timingRows
    .map((row) => elapsedSeconds(row.started_at, row.completed_at))
    .filter((value): value is number => value !== null);
  const sources = (await all(client, `
    SELECT state, COUNT(*) AS count
    FROM retrieval_source_inventory
    WHERE state IN ('pending', 'leased')
    GROUP BY state
    ORDER BY count DESC, state ASC
  `)).map((row) => ({
    state: stringValue(row.state),
    count: numberValue(row.count),
  }));
  const failureCodes = (await all(client, `
    SELECT COALESCE(NULLIF(TRIM(terminal_error_code), ''), 'unclassified') AS code,
           COUNT(*) AS count
    FROM reel_generation_jobs
    WHERE status = 'failed'
      AND created_at >= $1 AND created_at < $2
    GROUP BY COALESCE(NULLIF(TRIM(terminal_error_code), ''), 'unclassified')
    ORDER BY count DESC, code ASC
    LIMIT 6
  `, bounds)).map((row) => ({
    code: stringValue(row.code, "unclassified"),
    count: numberValue(row.count),
  }));
  return {
    jobs,
    queue_depth: numberValue(live.queued),
    running: numberValue(live.running),
    settled_rate_pct: percentage(settled, terminal),
    median_queue_seconds: median(queueTimes),
    median_run_seconds: median(runTimes),
    timing_sample_size: timingRows.length,
    timing_sample_limit: TIMING_SAMPLE_LIMIT,
    sources,
    failure_codes: failureCodes,
  };
}

async function economics(
  client: PoolClient,
  startDate: string,
  endExclusive: string,
): Promise<AnalyticsOverviewResponse["economics"]> {
  const bounds = [startDate, endExclusive];
  const usage = await one(client, `
    SELECT COALESCE(SUM(billable_requests), 0) AS billable_requests,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens,
           COALESCE(SUM(
             CASE WHEN total_tokens > 0 THEN billable_requests ELSE 0 END
           ), 0) AS token_bearing_requests
    FROM generation_provider_usage
    WHERE created_at >= $1 AND created_at < $2
  `, bounds);
  const providers = (await all(client, `
    SELECT provider,
           COALESCE(SUM(billable_requests), 0) AS billable_requests,
           COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM generation_provider_usage
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY provider
    ORDER BY billable_requests DESC, provider ASC
  `, bounds)).map((row) => ({
    provider: stringValue(row.provider),
    billable_requests: numberValue(row.billable_requests),
    total_tokens: numberValue(row.total_tokens),
  }));
  const operations = (await all(client, `
    SELECT operation,
           COALESCE(SUM(billable_requests), 0) AS billable_requests,
           COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM generation_provider_usage
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY operation
    ORDER BY billable_requests DESC, operation ASC
    LIMIT 8
  `, bounds)).map((row) => ({
    operation: stringValue(row.operation),
    billable_requests: numberValue(row.billable_requests),
    total_tokens: numberValue(row.total_tokens),
  }));
  const settled = await one(client, `
    SELECT COALESCE(SUM(
             CASE WHEN state = 'settled_known' THEN COALESCE(settled_microusd, 0)
                  ELSE 0 END
           ), 0) AS settled_known,
           COALESCE(SUM(
             CASE WHEN state = 'settled_unknown'
                  THEN COALESCE(unknown_microusd, reserved_microusd, 0)
                  ELSE 0 END
           ), 0) AS settled_unknown
    FROM material_openai_cost_ledger
    WHERE settled_at >= $1 AND settled_at < $2
  `, bounds);
  const reserved = await one(client, `
    SELECT COALESCE(SUM(reserved_microusd), 0) AS value
    FROM material_openai_cost_ledger
    WHERE state = 'reserved'
  `);
  const billableRequests = numberValue(usage.billable_requests);
  const tokenBearingRequests = numberValue(usage.token_bearing_requests);
  const totalTokens = numberValue(usage.total_tokens);
  const settledKnown = numberValue(settled.settled_known);
  const settledUnknown = numberValue(settled.settled_unknown);
  return {
    billable_requests: billableRequests,
    input_tokens: numberValue(usage.input_tokens),
    output_tokens: numberValue(usage.output_tokens),
    total_tokens: totalTokens,
    average_tokens_per_token_bearing_request: tokenBearingRequests
      ? Math.round((totalTokens / tokenBearingRequests) * 10) / 10
      : 0,
    settled_known_cost_microusd: settledKnown,
    settled_unknown_cost_microusd: settledUnknown,
    settled_cost_ceiling_microusd: settledKnown + settledUnknown,
    current_reserved_exposure_microusd: numberValue(reserved.value),
    providers,
    operations,
  };
}

async function content(
  client: PoolClient,
  startDate: string,
  endExclusive: string,
): Promise<AnalyticsOverviewResponse["content"]> {
  const bounds = [startDate, endExclusive];
  const distribution = (rows: Row[]): CountRow[] => rows.map((row) => ({
    label: stringValue(row.label),
    count: numberValue(row.count),
  }));
  const sourceTypes = distribution(await all(client, `
    SELECT COALESCE(NULLIF(TRIM(source_type), ''), 'unknown') AS label,
           COUNT(*) AS count
    FROM materials
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY COALESCE(NULLIF(TRIM(source_type), ''), 'unknown')
    ORDER BY count DESC, label ASC
  `, bounds));
  const knowledgeLevels = distribution(await all(client, `
    SELECT COALESCE(NULLIF(TRIM(knowledge_level), ''), 'unknown') AS label,
           COUNT(*) AS count
    FROM materials
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY COALESCE(NULLIF(TRIM(knowledge_level), ''), 'unknown')
    ORDER BY count DESC, label ASC
  `, bounds));
  return { source_types: sourceTypes, knowledge_levels: knowledgeLevels };
}

async function buildOverview(
  client: PoolClient,
  days: AnalyticsRangeDays,
  now: Date,
): Promise<AnalyticsOverviewResponse> {
  const window = analyticsWindow(days, now);
  const newAccountsQuery = `
    SELECT COUNT(*) AS value FROM community_accounts
    WHERE created_at >= $1 AND created_at < $2
  `;
  const consumedAccountsQuery = `
    SELECT COUNT(DISTINCT CASE
      WHEN usage.used_count > COALESCE(open.count, 0)
      THEN usage.account_id ELSE NULL END
    ) AS value
    FROM daily_search_usage AS usage
    LEFT JOIN (
      SELECT account_id, usage_day, COUNT(*) AS count
      FROM search_quota_reservations
      WHERE status = 'reserved'
      GROUP BY account_id, usage_day
    ) AS open
      ON open.account_id = usage.account_id
     AND open.usage_day = usage.usage_day
    WHERE usage.usage_day >= $1 AND usage.usage_day < $2
  `;
  const consumedSearchesQuery = `
    SELECT COALESCE(SUM(
      CASE WHEN usage.used_count > COALESCE(open.count, 0)
           THEN usage.used_count - COALESCE(open.count, 0)
           ELSE 0 END
    ), 0) AS value
    FROM daily_search_usage AS usage
    LEFT JOIN (
      SELECT account_id, usage_day, COUNT(*) AS count
      FROM search_quota_reservations
      WHERE status = 'reserved'
      GROUP BY account_id, usage_day
    ) AS open
      ON open.account_id = usage.account_id
     AND open.usage_day = usage.usage_day
    WHERE usage.usage_day >= $1 AND usage.usage_day < $2
  `;
  const releasedReelsQuery = `
    SELECT COUNT(*) AS value FROM reels
    WHERE inventory_state = 'release_now'
      AND released_at >= $1 AND released_at < $2
  `;
  const currentBounds = [window.startDate, window.endExclusive] as const;
  const previousBounds = [
    window.previousStartDate,
    window.previousEndExclusive,
  ] as const;
  const currentNewAccounts = await rangeCount(client, newAccountsQuery, ...currentBounds);
  const previousNewAccounts = await rangeCount(client, newAccountsQuery, ...previousBounds);
  const currentConsumedAccounts = await rangeCount(client, consumedAccountsQuery, ...currentBounds);
  const previousConsumedAccounts = await rangeCount(client, consumedAccountsQuery, ...previousBounds);
  const currentConsumedSearches = await rangeCount(client, consumedSearchesQuery, ...currentBounds);
  const previousConsumedSearches = await rangeCount(client, consumedSearchesQuery, ...previousBounds);
  const currentReleasedReels = await rangeCount(client, releasedReelsQuery, ...currentBounds);
  const previousReleasedReels = await rangeCount(client, releasedReelsQuery, ...previousBounds);
  const totalAccounts = numberValue((await one(
    client,
    "SELECT COUNT(*) AS value FROM community_accounts",
  )).value);
  const planCounts = await subscriptionCounts(client, now);
  const activeSubscriptionAccounts = planCounts.active.plus + planCounts.active.pro;
  const entitledAccounts = planCounts.entitled.plus + planCounts.entitled.pro;
  const estimatedPlanValueCents =
    planCounts.active.plus * PLAN_PRICE_CENTS.plus
    + planCounts.active.pro * PLAN_PRICE_CENTS.pro;

  return {
    generated_at: now.toISOString(),
    database: { engine: "postgresql" },
    range: {
      days,
      start_date: window.startDate,
      end_date: window.endDate,
      previous_start_date: window.previousStartDate,
      previous_end_date: window.previousEndDate,
      timezone: "UTC",
    },
    overview: {
      new_accounts: trend(currentNewAccounts, previousNewAccounts),
      consumed_search_accounts: trend(
        currentConsumedAccounts,
        previousConsumedAccounts,
      ),
      consumed_searches: trend(currentConsumedSearches, previousConsumedSearches),
      released_reels: trend(currentReleasedReels, previousReleasedReels),
      total_accounts: totalAccounts,
      entitled_accounts: entitledAccounts,
      active_subscription_accounts: activeSubscriptionAccounts,
      estimated_plan_value_cents: estimatedPlanValueCents,
      plans: planCounts.active,
      entitled_plans: planCounts.entitled,
    },
    series: await growthSeries(client, window.startDate, window.endDate),
    journey: await journey(client, totalAccounts, activeSubscriptionAccounts),
    engagement: await engagement(client, ...currentBounds),
    pipeline: await pipeline(client, ...currentBounds),
    economics: await economics(client, ...currentBounds),
    content: await content(client, ...currentBounds),
    definitions: {
      scope: "Metrics cover rows retained in the product database; deliberate cleanups can remove historical generation activity. The current UTC day is partial while the previous comparison window is complete.",
      consumed_search_accounts: "Distinct signed-in accounts whose retained daily quota usage exceeds their still-open reservations in the selected window.",
      consumed_searches: "Retained daily quota usage minus still-open reservations in the selected window; refunded searches are already removed from the ledger.",
      released_reels: "Reels durably marked release_now during the selected window.",
      subscriptions: "Entitled accounts include active, trialing, and grace-period access. Active subscriptions exclude trials and grace periods.",
      estimated_plan_value: "Current active-subscription monthly list value, not recognized revenue or collected cash; discounts and comped access are not stored here.",
      engagement: "Reel starts are first progress rows created in-window; reel completions use watched_to_end_at event time; the completion rate follows the in-window start cohort.",
      tracked_openai_cost: "Settled known and conservative unknown costs use settlement time; current reserved exposure is an all-time open snapshot. Supadata dollar cost is not stored.",
      pipeline_timing: `Pipeline counts cover all retained reel_generation_jobs, including order-only sidecars; queue and run medians use at most the newest ${TIMING_SAMPLE_LIMIT.toLocaleString("en-US")} jobs created in the selected window. Source work reports the current pending and leased inventory only, avoiding a lifetime completed-source scan.`,
    },
  };
}

export async function getAnalyticsOverview(
  days: AnalyticsRangeDays,
  now = new Date(),
): Promise<AnalyticsOverviewResponse> {
  const client = await pool().connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '25s'");
    const overview = await buildOverview(client, days, now);
    await client.query("COMMIT");
    transactionOpen = false;
    return overview;
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}

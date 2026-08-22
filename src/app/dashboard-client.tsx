"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

import type {
  AnalyticsOverviewResponse,
  AnalyticsRangeDays,
  AnalyticsSeriesPoint,
  AnalyticsTrend,
} from "@/lib/types";

import styles from "./dashboard.module.css";
import LogoutButton from "./logout-button";

const RANGE_DAYS = [7, 30, 90] as const;
const PRODUCT_URL = process.env.NEXT_PUBLIC_PRODUCT_URL;
const integerFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatInteger(value: number): string {
  return integerFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatCompact(value: number): string {
  return compactFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : "0.0"}%`;
}

function formatUsdMicros(value: number): string {
  const dollars = Math.max(0, Number(value) || 0) / 1_000_000;
  return dollars > 0 && dollars < 0.01 ? "<$0.01" : usdFormatter.format(dollars);
}

function formatUsdCents(value: number): string {
  return usdFormatter.format(Math.max(0, Number(value) || 0) / 100);
}

function formatDuration(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "Not available";
  }
  if (value < 60) {
    return `${value.toFixed(1)}s`;
  }
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

function formatDay(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(parsed);
}

function formatGeneratedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(parsed);
}

function sentenceCase(value: string): string {
  const label = value.replaceAll("_", " ").trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "Unknown";
}

function Trend({ trend }: { trend: AnalyticsTrend }) {
  if (trend.change_pct == null) {
    return <span className={styles.trendQuiet}>No prior baseline</span>;
  }
  const direction = trend.change_pct > 0 ? "up" : trend.change_pct < 0 ? "down" : "flat";
  const prefix = trend.change_pct > 0 ? "+" : "";
  const description = `${Math.abs(trend.change_pct).toFixed(1)} percent ${direction === "up" ? "increase" : direction === "down" ? "decrease" : "change"} from the previous period`;
  return (
    <span className={`${styles.trend} ${styles[`trend_${direction}`]}`}>
      <span aria-hidden="true">
        {prefix}{trend.change_pct.toFixed(1)}% {direction === "up" ? "↗" : direction === "down" ? "↘" : "—"}
      </span>
      <span className={styles.srOnly}>{description}</span>
    </span>
  );
}

function MetricCard({
  label,
  value,
  note,
  trend,
}: {
  label: string;
  value: string;
  note: string;
  trend?: AnalyticsTrend;
}) {
  return (
    <article className={styles.metricCard}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>{value}</p>
      <div className={styles.metricFooter}>
        <span>{note}</span>
        {trend ? <Trend trend={trend} /> : null}
      </div>
    </article>
  );
}

function SectionHeading({
  index,
  label,
  title,
  description,
}: {
  index: string;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <header className={styles.sectionHeading}>
      <p className={styles.sectionIndex}>{index} / {label}</p>
      <div>
        <h2 id={`${label.toLowerCase()}-title`}>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function chartPath(
  points: AnalyticsSeriesPoint[],
  field: "new_accounts" | "consumed_search_accounts" | "released_reels",
  maximum: number,
): string {
  const usableWidth = 740 - 52;
  const usableHeight = 224 - 20;
  const denominator = Math.max(1, points.length - 1);
  return points.map((point, index) => {
    const x = 52 + (index / denominator) * usableWidth;
    const y = 20 + usableHeight - (point[field] / maximum) * usableHeight;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function GrowthChart({ points }: { points: AnalyticsSeriesPoint[] }) {
  const maximum = Math.max(
    1,
    ...points.flatMap((point) => [
      point.new_accounts,
      point.consumed_search_accounts,
      point.released_reels,
    ]),
  );
  const labelIndexes = Array.from(new Set([
    0,
    Math.floor((points.length - 1) / 2),
    Math.max(0, points.length - 1),
  ]));
  const yTicks = Array.from(new Set([
    maximum,
    Math.round(maximum * 0.75),
    Math.round(maximum * 0.5),
    Math.round(maximum * 0.25),
    0,
  ])).sort((left, right) => right - left);
  return (
    <figure className={styles.chartFigure}>
      <div className={styles.chartLegend} aria-hidden="true">
        <span><i className={styles.legendAccounts} />New accounts</span>
        <span><i className={styles.legendActive} />Consumed-search accounts</span>
        <span><i className={styles.legendReels} />Released reels</span>
      </div>
      <svg
        className={styles.chart}
        viewBox="0 0 760 260"
        role="img"
        aria-label="Daily new accounts, consumed-search accounts, and released reels"
      >
        <title>Growth activity by day for the selected retained-database window</title>
        {yTicks.map((value) => {
          const y = 20 + (1 - value / maximum) * 204;
          return (
            <g key={value}>
              <line x1="52" x2="740" y1={y} y2={y} className={styles.chartGrid} />
              <text x="44" y={y + 3} textAnchor="end">{formatCompact(value)}</text>
            </g>
          );
        })}
        <path d={chartPath(points, "new_accounts", maximum)} className={styles.chartAccounts} />
        <path d={chartPath(points, "consumed_search_accounts", maximum)} className={styles.chartActive} />
        <path d={chartPath(points, "released_reels", maximum)} className={styles.chartReels} />
        {labelIndexes.map((index) => {
          const x = 52 + (index / Math.max(1, points.length - 1)) * 688;
          return (
            <text key={index} x={x} y="252" textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>
              {points[index] ? formatDay(points[index].date) : ""}
            </text>
          );
        })}
      </svg>
      <figcaption>Daily counts share one scale. Quota-consumed searches remain in the headline metrics because their volume would flatten the other series.</figcaption>
      <details className={styles.chartData}>
        <summary>View daily values</summary>
        <div className={styles.tableWrap}>
          <table>
            <caption className={styles.srOnly}>Daily values plotted in the growth chart</caption>
            <thead>
              <tr>
                <th scope="col">UTC day</th>
                <th scope="col">New accounts</th>
                <th scope="col">Search accounts</th>
                <th scope="col">Released reels</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  <td>{formatInteger(point.new_accounts)}</td>
                  <td>{formatInteger(point.consumed_search_accounts)}</td>
                  <td>{formatInteger(point.released_reels)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Distribution({
  rows,
  labelKey,
  emptyLabel,
}: {
  rows: Array<{ label: string; count: number }>;
  labelKey: string;
  emptyLabel: string;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  if (rows.length === 0) {
    return <p className={styles.emptyRow}>{emptyLabel}</p>;
  }
  return (
    <div className={styles.distribution}>
      {rows.map((row) => (
        <div className={styles.distributionRow} key={`${labelKey}-${row.label}`}>
          <div className={styles.distributionMeta}>
            <span>{sentenceCase(row.label)}</span>
            <strong>{formatInteger(row.count)}</strong>
          </div>
          <div className={styles.distributionTrack} aria-hidden="true">
            <span style={{ width: `${Math.max(3, (row.count / maximum) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DataPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className={styles.dataPanel}>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

function LoadingPanel() {
  return (
    <div className={styles.loadingPanel} role="status" aria-live="polite">
      <span className={styles.loadingMark} aria-hidden="true" />
      <p>Reading retained product records…</p>
    </div>
  );
}

function Dashboard({ data }: { data: AnalyticsOverviewResponse }) {
  const overview = data.overview;
  const engagement = data.engagement;
  const pipeline = data.pipeline;
  const economics = data.economics;
  const journeyMaximum = Math.max(1, ...data.journey.map((stage) => stage.value));

  return (
    <div className={styles.dashboardBody}>
      <section className={styles.section} aria-labelledby="growth-title">
        <SectionHeading
          index="01"
          label="Growth"
          title="Growth in the database, not vanity traffic."
          description="Accounts and product activity retained inside the selected UTC window, compared with the immediately preceding window."
        />
        <div className={styles.metricGrid}>
          <MetricCard
            label="New accounts"
            value={formatInteger(overview.new_accounts.value)}
            note={`${formatInteger(overview.new_accounts.previous)} previous`}
            trend={overview.new_accounts}
          />
          <MetricCard
            label="Consumed-search accounts"
            value={formatInteger(overview.consumed_search_accounts.value)}
            note="Distinct accounts after open reservations"
            trend={overview.consumed_search_accounts}
          />
          <MetricCard
            label="Consumed searches"
            value={formatInteger(overview.consumed_searches.value)}
            note="Quota use after open reservations"
            trend={overview.consumed_searches}
          />
          <MetricCard
            label="Released reels"
            value={formatInteger(overview.released_reels.value)}
            note="Durable release_now rows"
            trend={overview.released_reels}
          />
        </div>
        <div className={styles.growthGrid}>
          <GrowthChart points={data.series} />
          <aside className={styles.growthAside} aria-label="Account base snapshot">
            <p className={styles.microLabel}>Current retained base</p>
            <p className={styles.heroMetric}>{formatInteger(overview.total_accounts)}</p>
            <p className={styles.heroMetricLabel}>accounts in the database</p>
            <div className={styles.asideRule} />
            <div className={styles.asideSplit}>
              <span><strong>{formatInteger(overview.active_subscription_accounts)}</strong> active subscriptions</span>
              <span><strong>{formatInteger(overview.entitled_accounts)}</strong> entitled accounts</span>
              <span><strong>{formatInteger(overview.plans.plus)}</strong> Plus</span>
              <span><strong>{formatInteger(overview.plans.pro)}</strong> Pro</span>
            </div>
          </aside>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="journey-title">
        <SectionHeading
          index="02"
          label="Journey"
          title="A retained signal ladder."
          description="These are independent retained-record signals, not a strict funnel. Each stage is measured against all accounts currently present in the product database."
        />
        <div className={styles.twoColumn}>
          <DataPanel title="Account journey">
            <ol className={styles.journeyList}>
              {data.journey.map((stage, index) => (
                <li key={stage.key}>
                  <div className={styles.journeyMeta}>
                    <span><i>{String(index + 1).padStart(2, "0")}</i>{stage.label}</span>
                    <strong>{formatInteger(stage.value)} <small>{formatPercent(stage.conversion_pct)}</small></strong>
                  </div>
                  <div className={styles.journeyTrack} aria-hidden="true">
                    <span style={{ width: `${Math.max(2, (stage.value / journeyMaximum) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          </DataPanel>
          <div className={styles.stackPanels}>
            <DataPanel title="Source mix">
              <Distribution rows={data.content.source_types} labelKey="source" emptyLabel="No materials in this window." />
            </DataPanel>
            <DataPanel title="Knowledge levels">
              <Distribution rows={data.content.knowledge_levels} labelKey="level" emptyLabel="No knowledge levels in this window." />
            </DataPanel>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="engagement-title">
        <SectionHeading
          index="03"
          label="Engagement"
          title="Learning signals after the search."
          description="Starts, natural completions, explicit feedback, and assessment attempts recorded during the selected window."
        />
        <div className={styles.metricGridThree}>
          <MetricCard
            label="Start-cohort completion"
            value={formatPercent(engagement.start_cohort_completion_rate_pct)}
            note={`${formatInteger(engagement.start_cohort_completions)} of ${formatInteger(engagement.reel_starts)} starts · ${formatInteger(engagement.reel_completions)} completion events`}
          />
          <MetricCard
            label="Helpful feedback"
            value={formatPercent(engagement.helpful_rate_pct)}
            note={`${formatInteger(engagement.helpful)} helpful · ${formatInteger(engagement.confusing)} confusing`}
          />
          <MetricCard
            label="Assessment accuracy"
            value={formatPercent(engagement.assessment_accuracy_pct)}
            note={`${formatInteger(engagement.assessment_correct)} of ${formatInteger(engagement.assessment_attempts)} attempts`}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="pipeline-title">
        <SectionHeading
          index="04"
          label="Pipeline"
          title="What is moving, waiting, and failing."
          description="Backend job outcomes use the selected window; live queue depth and source inventory are present-state snapshots."
        />
        <div className={styles.pipelineStrip}>
          <div><span>Queued now</span><strong>{formatInteger(pipeline.queue_depth)}</strong></div>
          <div><span>Running now</span><strong>{formatInteger(pipeline.running)}</strong></div>
          <div><span>Settled rate</span><strong>{formatPercent(pipeline.settled_rate_pct)}</strong></div>
          <div><span>Median queue</span><strong>{formatDuration(pipeline.median_queue_seconds)}</strong></div>
          <div><span>Median run</span><strong>{formatDuration(pipeline.median_run_seconds)}</strong></div>
        </div>
        <div className={styles.threeColumn}>
          <DataPanel title="Backend job outcomes">
            <Distribution
              rows={pipeline.jobs.map((row) => ({ label: row.status, count: row.count }))}
              labelKey="job"
              emptyLabel="No jobs in this window."
            />
          </DataPanel>
          <DataPanel title="Source work now">
            <Distribution
              rows={pipeline.sources.map((row) => ({ label: row.state, count: row.count }))}
              labelKey="inventory"
              emptyLabel="No pending or leased source work."
            />
          </DataPanel>
          <DataPanel title="Top failure codes">
            <Distribution
              rows={pipeline.failure_codes.map((row) => ({ label: row.code, count: row.count }))}
              labelKey="failure"
              emptyLabel="No failed jobs in this window."
            />
          </DataPanel>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="economics-title">
        <SectionHeading
          index="05"
          label="Economics"
          title="Tracked exposure, with its uncertainty intact."
          description="OpenAI ledger values and current active-plan list value. This is not complete provider spend, recognized revenue, or collected cash."
        />
        <div className={styles.metricGrid}>
          <MetricCard
            label="Settled-known OpenAI cost"
            value={formatUsdMicros(economics.settled_known_cost_microusd)}
            note={`${formatUsdMicros(economics.settled_cost_ceiling_microusd)} ceiling incl. unknown settlements`}
          />
          <MetricCard
            label="Current reserved exposure"
            value={formatUsdMicros(economics.current_reserved_exposure_microusd)}
            note={`${formatUsdMicros(economics.settled_unknown_cost_microusd)} settled-unknown in window`}
          />
          <MetricCard
            label="Billable provider requests"
            value={formatInteger(economics.billable_requests)}
            note={`${formatCompact(economics.total_tokens)} tracked tokens`}
          />
          <MetricCard
            label="Est. monthly plan value"
            value={formatUsdCents(overview.estimated_plan_value_cents)}
            note="Active-subscription list value"
          />
        </div>
        <div className={styles.twoColumn}>
          <DataPanel title="Provider usage">
            <div className={styles.tableWrap}>
              <table>
                <caption className={styles.srOnly}>Provider usage in the selected UTC window</caption>
                <thead><tr><th scope="col">Provider</th><th scope="col">Requests</th><th scope="col">Tokens</th></tr></thead>
                <tbody>
                  {economics.providers.length ? economics.providers.map((row) => (
                    <tr key={row.provider}>
                      <td>{sentenceCase(row.provider)}</td>
                      <td>{formatInteger(row.billable_requests)}</td>
                      <td>{formatCompact(row.total_tokens)}</td>
                    </tr>
                  )) : <tr><td colSpan={3}>No tracked provider usage.</td></tr>}
                </tbody>
              </table>
            </div>
          </DataPanel>
          <DataPanel title="Highest-volume operations">
            <div className={styles.tableWrap}>
              <table>
                <caption className={styles.srOnly}>Highest-volume operations in the selected UTC window</caption>
                <thead><tr><th scope="col">Operation</th><th scope="col">Requests</th><th scope="col">Tokens</th></tr></thead>
                <tbody>
                  {economics.operations.length ? economics.operations.map((row) => (
                    <tr key={row.operation}>
                      <td>{sentenceCase(row.operation)}</td>
                      <td>{formatInteger(row.billable_requests)}</td>
                      <td>{formatCompact(row.total_tokens)}</td>
                    </tr>
                  )) : <tr><td colSpan={3}>No tracked operation usage.</td></tr>}
                </tbody>
              </table>
            </div>
          </DataPanel>
        </div>
      </section>

      <aside className={styles.definitionPanel} aria-label="Metric definitions and limitations">
        <p className={styles.microLabel}>Read this dashboard correctly</p>
        <p>{data.definitions.scope}</p>
        <div>
          <span>{data.definitions.consumed_search_accounts}</span>
          <span>{data.definitions.consumed_searches}</span>
          <span>{data.definitions.subscriptions}</span>
          <span>{data.definitions.estimated_plan_value}</span>
          <span>{data.definitions.engagement}</span>
          <span>{data.definitions.tracked_openai_cost}</span>
          <span>{data.definitions.pipeline_timing}</span>
        </div>
      </aside>
    </div>
  );
}

async function fetchOverview(
  days: AnalyticsRangeDays,
  signal: AbortSignal,
): Promise<AnalyticsOverviewResponse> {
  const response = await fetch(`/api/overview?days=${days}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("Your private session expired.");
  }
  if (!response.ok) {
    throw new Error("The analytics read could not be completed.");
  }
  const overview = await response.json() as AnalyticsOverviewResponse;
  if (
    !overview
    || typeof overview !== "object"
    || !overview.overview
    || !Array.isArray(overview.series)
    || !Array.isArray(overview.journey)
  ) {
    throw new Error("The analytics service returned an invalid response.");
  }
  return overview;
}

export default function DashboardClient() {
  const [days, setDays] = useState<AnalyticsRangeDays>(30);
  const [data, setData] = useState<AnalyticsOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);
    setError(null);
    void fetchOverview(days, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setData(response);
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(caught instanceof Error ? caught.message : "Analytics could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRefreshing(false);
        }
      });
    return () => controller.abort();
  }, [days, refreshRevision]);

  return (
    <div className={styles.shell}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.topbar}>
        <a href="/" className={styles.brand} aria-label="Nosca analytics home">
          <Image src="/nosca-logo.svg" alt="" width={34} height={26} priority />
          <span>Nosca</span>
        </a>
        <div className={styles.topbarMeta}>
          <span>Owner console</span>
          <i aria-hidden="true" />
          <span>{data?.database.engine === "postgresql" ? "Railway PostgreSQL" : data?.database.engine || "Private data"}</span>
        </div>
        <div className={styles.topbarActions}>
          {PRODUCT_URL ? (
            <a href={PRODUCT_URL} className={styles.appLink}>Open app <span aria-hidden="true">↗</span></a>
          ) : null}
          <LogoutButton className={styles.signOutButton}>Sign out</LogoutButton>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="analytics-title">
          <div>
            <p className={styles.eyebrow}>OWNER / RETAINED DATABASE ANALYTICS</p>
            <h1 id="analytics-title">Analytics</h1>
            <p className={styles.heroCopy}>A product instrument for growth, learning behavior, generation health, and tracked economics—grounded only in records the product still retains.</p>
          </div>
          <div className={styles.heroControls}>
            <div className={styles.rangeControl} role="group" aria-label="Analytics date range">
              {RANGE_DAYS.map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-label={`Show the last ${range} days`}
                  aria-pressed={days === range}
                  className={days === range ? styles.rangeActive : undefined}
                  onClick={() => {
                    if (range !== days) setData(null);
                    setDays(range);
                  }}
                >
                  {range}D
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.refreshButton}
              disabled={refreshing}
              onClick={() => setRefreshRevision((revision) => revision + 1)}
              aria-label="Refresh analytics"
            >
              <span className={refreshing ? styles.refreshing : undefined} aria-hidden="true">↻</span>
              {refreshing ? "Reading" : "Refresh"}
            </button>
          </div>
          <div className={styles.heroRule} />
          <div className={styles.rangeSummary}>
            <span>{data ? `${formatDay(data.range.start_date)} — ${formatDay(data.range.end_date)}` : `Last ${days} UTC days`}</span>
            <span>{data ? `Updated ${formatGeneratedAt(data.generated_at)}` : "Reading the private database"}</span>
          </div>
        </section>

        {error ? (
          <div className={styles.errorBanner} role="alert">
            <div>
              <p>The latest read failed</p>
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setRefreshRevision((revision) => revision + 1)}>Try again</button>
          </div>
        ) : null}

        {!data && refreshing ? <LoadingPanel /> : null}
        {data ? <Dashboard data={data} /> : null}
      </main>

      <footer className={styles.footer}>
        <span>Nosca / private operator surface</span>
        <span>Not traffic analytics. Not recognized revenue.</span>
      </footer>
    </div>
  );
}

import { addUtcDays, analyticsWindow, trend } from "@/lib/analytics-core";
import type {
  AnalyticsOverviewResponse,
  AnalyticsRangeDays,
} from "@/lib/types";

export function buildDemoOverview(
  days: AnalyticsRangeDays,
  now = new Date(),
): AnalyticsOverviewResponse {
  const window = analyticsWindow(days, now);
  const series = Array.from({ length: days }, (_, index) => ({
    date: addUtcDays(window.startDate, index),
    new_accounts: 1 + ((index * 3 + 2) % 7),
    consumed_search_accounts: 2 + ((index * 5 + 1) % 10),
    consumed_searches: 9 + ((index * 13 + 4) % 38),
    released_reels: 3 + ((index * 11 + 5) % 22),
  }));
  const sum = (key: keyof (typeof series)[number]) => series.reduce(
    (total, point) => total + (typeof point[key] === "number" ? point[key] : 0),
    0,
  );
  const accounts = sum("new_accounts");
  const active = sum("consumed_search_accounts");
  const searches = sum("consumed_searches");
  const reels = sum("released_reels");
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
      new_accounts: trend(accounts, Math.round(accounts * 0.78)),
      consumed_search_accounts: trend(active, Math.round(active * 0.84)),
      consumed_searches: trend(searches, Math.round(searches * 0.71)),
      released_reels: trend(reels, Math.round(reels * 0.76)),
      total_accounts: 486,
      entitled_accounts: 58,
      active_subscription_accounts: 47,
      estimated_plan_value_cents: 52_853,
      plans: { plus: 31, pro: 16 },
      entitled_plans: { plus: 39, pro: 19 },
    },
    series,
    journey: [
      { key: "signed_up", label: "Signed up", value: 486, conversion_pct: 100 },
      { key: "searched", label: "Started a search", value: 391, conversion_pct: 80.5 },
      { key: "watched", label: "Watched a reel", value: 344, conversion_pct: 70.8 },
      { key: "returned", label: "Returned another day", value: 218, conversion_pct: 44.9 },
      { key: "active_subscription", label: "Active subscription", value: 47, conversion_pct: 9.7 },
    ],
    engagement: {
      reel_starts: 1_842,
      reel_completions: 1_338,
      start_cohort_completions: 1_227,
      start_cohort_completion_rate_pct: 66.6,
      helpful: 214,
      confusing: 49,
      helpful_rate_pct: 81.4,
      assessment_attempts: 612,
      assessment_correct: 447,
      assessment_accuracy_pct: 73,
    },
    pipeline: {
      jobs: [
        { status: "completed", count: 381 },
        { status: "partial", count: 67 },
        { status: "failed", count: 29 },
        { status: "exhausted", count: 18 },
      ],
      queue_depth: 3,
      running: 6,
      settled_rate_pct: 94.1,
      median_queue_seconds: 1.8,
      median_run_seconds: 73.4,
      timing_sample_size: 492,
      timing_sample_limit: 10_000,
      sources: [
        { state: "pending", count: 2_481 },
        { state: "leased", count: 14 },
      ],
      failure_codes: [
        { code: "provider_empty_cohort", count: 11 },
        { code: "provider_timeout", count: 8 },
        { code: "invalid_selector_output", count: 5 },
      ],
    },
    economics: {
      billable_requests: 2_947,
      input_tokens: 9_281_402,
      output_tokens: 3_814_998,
      total_tokens: 13_096_400,
      average_tokens_per_token_bearing_request: 4_543.2,
      settled_known_cost_microusd: 38_421_000,
      settled_unknown_cost_microusd: 1_884_000,
      settled_cost_ceiling_microusd: 40_305_000,
      current_reserved_exposure_microusd: 2_116_000,
      providers: [
        { provider: "openai", billable_requests: 2_121, total_tokens: 13_096_400 },
        { provider: "supadata", billable_requests: 826, total_tokens: 0 },
      ],
      operations: [
        { operation: "clip_selection", billable_requests: 1_487, total_tokens: 9_841_992 },
        { operation: "lesson_ordering", billable_requests: 391, total_tokens: 2_127_801 },
        { operation: "assessment", billable_requests: 243, total_tokens: 1_126_607 },
        { operation: "video_search", billable_requests: 826, total_tokens: 0 },
      ],
    },
    content: {
      source_types: [
        { label: "topic", count: 224 },
        { label: "document", count: 93 },
        { label: "url", count: 48 },
        { label: "image", count: 17 },
      ],
      knowledge_levels: [
        { label: "beginner", count: 208 },
        { label: "intermediate", count: 119 },
        { label: "advanced", count: 55 },
      ],
    },
    definitions: {
      scope: "Metrics cover rows retained in the product database; deliberate cleanups can remove historical generation activity. The current UTC day is partial while the previous comparison window is complete.",
      consumed_search_accounts: "Distinct signed-in accounts whose retained daily quota usage exceeds their still-open reservations in the selected window.",
      consumed_searches: "Retained daily quota usage minus still-open reservations in the selected window; refunded searches are already removed from the ledger.",
      released_reels: "Reels durably marked release_now during the selected window.",
      subscriptions: "Entitled accounts include active, trialing, and grace-period access. Active subscriptions exclude trials and grace periods.",
      estimated_plan_value: "Current active-subscription monthly list value, not recognized revenue or collected cash; discounts and comped access are not stored here.",
      engagement: "Reel starts are first progress rows created in-window; reel completions use watched_to_end_at event time; the completion rate follows the in-window start cohort.",
      tracked_openai_cost: "Settled known and conservative unknown costs use settlement time; current reserved exposure is an all-time open snapshot. Supadata dollar cost is not stored.",
      pipeline_timing: "Pipeline counts cover all retained reel_generation_jobs, including order-only sidecars; queue and run medians use at most the newest 10,000 jobs created in the selected window.",
    },
  };
}

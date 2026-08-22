export const ANALYTICS_RANGE_DAYS = [7, 30, 90] as const;

export type AnalyticsRangeDays = (typeof ANALYTICS_RANGE_DAYS)[number];

export type AnalyticsTrend = {
  value: number;
  previous: number;
  change_pct: number | null;
};

export type AnalyticsSeriesPoint = {
  date: string;
  new_accounts: number;
  consumed_search_accounts: number;
  consumed_searches: number;
  released_reels: number;
};

export type AnalyticsJourneyStage = {
  key: string;
  label: string;
  value: number;
  conversion_pct: number;
};

export type AnalyticsOverviewResponse = {
  generated_at: string;
  database: {
    engine: "postgresql";
  };
  range: {
    days: AnalyticsRangeDays;
    start_date: string;
    end_date: string;
    previous_start_date: string;
    previous_end_date: string;
    timezone: "UTC";
  };
  overview: {
    new_accounts: AnalyticsTrend;
    consumed_search_accounts: AnalyticsTrend;
    consumed_searches: AnalyticsTrend;
    released_reels: AnalyticsTrend;
    total_accounts: number;
    entitled_accounts: number;
    active_subscription_accounts: number;
    estimated_plan_value_cents: number;
    plans: Record<"plus" | "pro", number>;
    entitled_plans: Record<"plus" | "pro", number>;
  };
  series: AnalyticsSeriesPoint[];
  journey: AnalyticsJourneyStage[];
  engagement: {
    reel_starts: number;
    reel_completions: number;
    start_cohort_completions: number;
    start_cohort_completion_rate_pct: number;
    helpful: number;
    confusing: number;
    helpful_rate_pct: number;
    assessment_attempts: number;
    assessment_correct: number;
    assessment_accuracy_pct: number;
  };
  pipeline: {
    jobs: Array<{ status: string; count: number }>;
    queue_depth: number;
    running: number;
    settled_rate_pct: number;
    median_queue_seconds: number | null;
    median_run_seconds: number | null;
    timing_sample_size: number;
    timing_sample_limit: number;
    sources: Array<{ state: string; count: number }>;
    failure_codes: Array<{ code: string; count: number }>;
  };
  economics: {
    billable_requests: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    average_tokens_per_token_bearing_request: number;
    settled_known_cost_microusd: number;
    settled_unknown_cost_microusd: number;
    settled_cost_ceiling_microusd: number;
    current_reserved_exposure_microusd: number;
    providers: Array<{
      provider: string;
      billable_requests: number;
      total_tokens: number;
    }>;
    operations: Array<{
      operation: string;
      billable_requests: number;
      total_tokens: number;
    }>;
  };
  content: {
    source_types: Array<{ label: string; count: number }>;
    knowledge_levels: Array<{ label: string; count: number }>;
  };
  definitions: {
    scope: string;
    consumed_search_accounts: string;
    consumed_searches: string;
    released_reels: string;
    subscriptions: string;
    estimated_plan_value: string;
    engagement: string;
    tracked_openai_cost: string;
    pipeline_timing: string;
  };
};

export function isAnalyticsRangeDays(value: number): value is AnalyticsRangeDays {
  return ANALYTICS_RANGE_DAYS.includes(value as AnalyticsRangeDays);
}

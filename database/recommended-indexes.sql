-- Production prerequisite for the standalone analytics query shape.
--
-- This file is documentation for the product database owner. Do not run it with
-- the analytics_reader credential. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block; review current query plans and build one index at a time
-- during a low-traffic window through the product's normal operations process.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_accounts_created
  ON community_accounts (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_subscriptions_current
  ON billing_subscriptions (provider_environment, status, current_period_end, account_id)
  WHERE provider = 'stripe' AND plan_code IN ('plus', 'pro');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_usage_day_account
  ON daily_search_usage (usage_day, account_id) INCLUDE (used_count);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_open_reservations
  ON search_quota_reservations (account_id, usage_day)
  WHERE status = 'reserved';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_reels_released
  ON reels (released_at) WHERE inventory_state = 'release_now';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_source_work_state
  ON retrieval_source_inventory (state)
  WHERE state IN ('pending', 'leased');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_progress_created
  ON learner_reel_progress (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_progress_watched
  ON learner_reel_progress (watched_to_end_at)
  WHERE watched_to_end_at IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_feedback_mastery
  ON reel_feedback (mastery_updated_at) INCLUDE (helpful, confusing)
  WHERE mastery_updated_at IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_attempts_created
  ON assessment_attempts (created_at) INCLUDE (is_correct);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_jobs_created
  ON reel_generation_jobs (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_provider_usage_created
  ON generation_provider_usage (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_cost_settled
  ON material_openai_cost_ledger (settled_at)
  INCLUDE (state, settled_microusd, unknown_microusd, reserved_microusd)
  WHERE settled_at IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_cost_reserved
  ON material_openai_cost_ledger (reserved_microusd)
  WHERE state = 'reserved';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_materials_created
  ON materials (created_at);

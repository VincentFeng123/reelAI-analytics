import assert from "node:assert/strict";
import test from "node:test";

import {
  analyticsWindow,
  elapsedSeconds,
  median,
  percentage,
  trend,
} from "../src/lib/analytics-core";
import { buildDemoOverview } from "../src/lib/demo-overview";

test("UTC windows are inclusive by day and compare to the adjacent prior window", () => {
  assert.deepEqual(
    analyticsWindow(7, new Date("2026-08-22T23:59:59.000-07:00")),
    {
      startDate: "2026-08-17",
      endDate: "2026-08-23",
      endExclusive: "2026-08-24",
      previousStartDate: "2026-08-10",
      previousEndDate: "2026-08-16",
      previousEndExclusive: "2026-08-17",
    },
  );
});

test("trend, percentage, median, and elapsed helpers preserve metric semantics", () => {
  assert.deepEqual(trend(15, 10), { value: 15, previous: 10, change_pct: 50 });
  assert.deepEqual(trend(2, 0), { value: 2, previous: 0, change_pct: null });
  assert.equal(percentage(2, 3), 66.7);
  assert.equal(percentage(1, 0), 0);
  assert.equal(median([9, 1, 3, 7]), 5);
  assert.equal(elapsedSeconds("2026-08-22T00:00:00Z", "2026-08-22T00:01:15Z"), 75);
  assert.equal(elapsedSeconds("bad", "2026-08-22T00:01:15Z"), null);
});

test("the deterministic preview covers each supported range and returns aggregates only", () => {
  for (const days of [7, 30, 90] as const) {
    const overview = buildDemoOverview(days, new Date("2026-08-22T12:00:00Z"));
    assert.equal(overview.range.days, days);
    assert.equal(overview.series.length, days);
    assert.equal(overview.database.engine, "postgresql");
    assert.ok(overview.overview.total_accounts > 0);
    assert.ok(overview.pipeline.jobs.length > 0);
    const serialized = JSON.stringify(overview);
    for (const forbiddenKey of [
      '"email"',
      '"username"',
      '"account_id"',
      '"learner_id"',
      '"raw_text"',
      '"search_query"',
    ]) {
      assert.equal(serialized.includes(forbiddenKey), false, forbiddenKey);
    }
  }
});

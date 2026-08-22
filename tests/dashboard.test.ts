import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardUrl = new URL("../src/app/dashboard-client.tsx", import.meta.url);

test("daily and window-distinct user metrics remain explicitly separated", async () => {
  const dashboard = await readFile(dashboardUrl, "utf8");
  assert.match(dashboard, /formatCompact\(trends\[entry\.key\]\.value\)/);
  assert.match(dashboard, /selected === "consumed_search_accounts" \? "User-days" : "Total"/);
  assert.match(dashboard, /average: values\.reduce\(\(sum, value\) => sum \+ value, 0\)/);
});

test("zero-denominator ratios and zero-on-zero trends do not invent activity", async () => {
  const dashboard = await readFile(dashboardUrl, "utf8");
  assert.match(dashboard, /trend\.value > 0 \? "NEW" : "—"/);
  assert.match(dashboard, /point\.consumed_search_accounts > 0 \?/);
  assert.match(dashboard, /point\.consumed_searches > 0 \?/);
  assert.doesNotMatch(dashboard, /point\.released_reels \/ Math\.max\(1, point\.consumed_searches\)/);
});

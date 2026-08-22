"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const decimalFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

type SeriesKey = "new_accounts" | "consumed_search_accounts" | "consumed_searches" | "released_reels";

const SERIES: Array<{ key: SeriesKey; label: string; shortLabel: string }> = [
  { key: "new_accounts", label: "New accounts", shortLabel: "Accounts" },
  { key: "consumed_search_accounts", label: "Search users", shortLabel: "Users" },
  { key: "consumed_searches", label: "Consumed searches", shortLabel: "Searches" },
  { key: "released_reels", label: "Released reels", shortLabel: "Reels" },
];

function formatInteger(value: number): string {
  return integerFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatCompact(value: number): string {
  return compactFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatDecimal(value: number): string {
  return decimalFormatter.format(Number.isFinite(value) ? value : 0);
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
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 60) return `${value.toFixed(1)}s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

function formatDay(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  }).format(parsed);
}

function formatGeneratedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown" : new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(parsed);
}

function sentenceCase(value: string): string {
  const label = value.replaceAll("_", " ").trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "Unknown";
}

function sumSeries(points: AnalyticsSeriesPoint[], field: SeriesKey): number {
  return points.reduce((total, point) => total + point[field], 0);
}

function movingAverage(values: number[], windowSize: number): number[] {
  return values.map((_, index) => {
    const window = values.slice(Math.max(0, index - windowSize + 1), index + 1);
    return window.reduce((total, value) => total + value, 0) / window.length;
  });
}

function TrendBadge({ trend }: { trend: AnalyticsTrend }) {
  if (trend.change_pct == null) return <span className={styles.trendQuiet}>{trend.value > 0 ? "NEW" : "—"}</span>;
  const direction = trend.change_pct > 0 ? "up" : trend.change_pct < 0 ? "down" : "flat";
  const prefix = trend.change_pct > 0 ? "+" : "";
  const description = `${Math.abs(trend.change_pct).toFixed(1)} percent ${direction === "up" ? "increase" : direction === "down" ? "decrease" : "change"} from the previous period`;
  return (
    <span className={`${styles.trend} ${styles[`trend_${direction}`]}`}>
      <span aria-hidden="true">{prefix}{trend.change_pct.toFixed(1)}% {direction === "up" ? "↗" : direction === "down" ? "↘" : "—"}</span>
      <span className={styles.srOnly}>{description}</span>
    </span>
  );
}

function MiniSparkline({ values }: { values: number[] }) {
  const width = 104;
  const height = 34;
  const maximum = Math.max(1, ...values);
  const minimum = Math.min(0, ...values);
  const span = Math.max(1, maximum - minimum);
  const denominator = Math.max(1, values.length - 1);
  const path = values.map((value, index) => {
    const x = (index / denominator) * width;
    const y = 3 + (1 - (value - minimum) / span) * (height - 6);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return <svg className={styles.sparkline} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><path d={path} /></svg>;
}

function SignalCard({
  label, value, note, trend, series, progress,
}: {
  label: string;
  value: string;
  note: string;
  trend?: AnalyticsTrend;
  series?: number[];
  progress?: number;
}) {
  return (
    <article className={styles.signalCard}>
      <header className={styles.signalHeader}><span>{label}</span>{trend ? <TrendBadge trend={trend} /> : null}</header>
      <strong className={styles.signalValue}>{value}</strong>
      <footer className={styles.signalFooter}><span>{note}</span>{series ? <MiniSparkline values={series} /> : null}</footer>
      {progress == null ? null : <div className={styles.signalProgress} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>}
    </article>
  );
}

function PanelHeader({
  index, label, title, meta, action,
}: {
  index: string;
  label: string;
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.panelHeader}>
      <div><span className={styles.panelIndex}>{index} · {label}</span><h2>{title}</h2></div>
      {action || (meta ? <span className={styles.panelMeta}>{meta}</span> : null)}
    </header>
  );
}

function chartPath(values: number[], width: number, height: number, maximum: number): string {
  const denominator = Math.max(1, values.length - 1);
  return values.map((value, index) => {
    const x = 46 + (index / denominator) * (width - 62);
    const y = 12 + (1 - value / maximum) * (height - 42);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function ActivityChart({
  points, trends,
}: {
  points: AnalyticsSeriesPoint[];
  trends: Record<SeriesKey, AnalyticsTrend>;
}) {
  const [selected, setSelected] = useState<SeriesKey>("consumed_searches");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const metric = SERIES.find((entry) => entry.key === selected) || SERIES[0];
  const values = points.map((point) => point[selected]);
  const averages = movingAverage(values, 7);
  const maximum = Math.max(1, ...values, ...averages);
  const total = values.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(0, ...values);
  const peakIndex = Math.max(0, values.indexOf(peak));
  const activeIndex = Math.max(0, Math.min(points.length - 1, hoveredIndex ?? points.length - 1));
  const activePoint = points[activeIndex];
  const width = 900;
  const height = 276;
  const xForIndex = (index: number) => 46 + (index / Math.max(1, points.length - 1)) * (width - 62);
  const activeX = xForIndex(activeIndex);
  const activeY = 12 + (1 - (activePoint?.[selected] || 0) / maximum) * (height - 42);
  const tooltipX = Math.min(width - 126, Math.max(52, activeX - 54));
  const yTicks = [maximum, maximum * 0.75, maximum * 0.5, maximum * 0.25, 0];
  const labelIndexes = Array.from(new Set([0, Math.floor((points.length - 1) * 0.25), Math.floor((points.length - 1) * 0.5), Math.floor((points.length - 1) * 0.75), Math.max(0, points.length - 1)]));
  const line = chartPath(values, width, height, maximum);
  const averageLine = chartPath(averages, width, height, maximum);
  const area = `${line} L ${xForIndex(Math.max(0, values.length - 1)).toFixed(2)} ${(height - 30).toFixed(2)} L 46 ${(height - 30).toFixed(2)} Z`;

  return (
    <article className={styles.chartPanel} id="growth">
      <PanelHeader index="01" label="Growth" title="Daily activity" meta={`${points.length} UTC points`} />
      <div className={styles.metricTabs} role="group" aria-label="Daily chart metric">
        {SERIES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={selected === entry.key}
            className={selected === entry.key ? styles.metricTabActive : undefined}
            onClick={() => { setSelected(entry.key); setHoveredIndex(null); }}
          >
            <span>{entry.shortLabel}</span><strong>{formatCompact(trends[entry.key].value)}</strong><TrendBadge trend={trends[entry.key]} />
          </button>
        ))}
      </div>
      <div className={styles.chartStats}>
        <div><span>{selected === "consumed_search_accounts" ? "User-days" : "Total"}</span><strong>{formatInteger(total)}</strong></div>
        <div><span>Daily avg</span><strong>{formatDecimal(total / Math.max(1, values.length))}</strong></div>
        <div><span>Peak</span><strong>{formatInteger(peak)} <small>{formatDay(points[peakIndex]?.date || "")}</small></strong></div>
        <div><span>Latest</span><strong>{formatInteger(values.at(-1) || 0)}</strong></div>
      </div>
      <figure className={styles.activityFigure}>
        <svg className={styles.activityChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily activity trend for the selected metric" onMouseLeave={() => setHoveredIndex(null)}>
          <title>Daily {metric.label.toLowerCase()} with a seven-day moving average</title>
          {yTicks.map((value, index) => {
            const y = 12 + (index / 4) * (height - 42);
            return <g key={`${value}-${index}`}><line x1="46" x2={width - 16} y1={y} y2={y} className={styles.chartGrid} /><text x="38" y={y + 4} textAnchor="end" className={styles.chartAxis}>{formatCompact(value)}</text></g>;
          })}
          <path d={area} className={styles.chartArea} />
          <path d={averageLine} className={styles.chartAverage} />
          <path d={line} className={styles.chartLine} />
          {labelIndexes.map((index) => <text key={index} x={xForIndex(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className={styles.chartAxis}>{points[index] ? formatDay(points[index].date) : ""}</text>)}
          {points.map((point, index) => {
            const sliceWidth = (width - 62) / Math.max(1, points.length);
            return <rect key={point.date} x={Math.max(46, xForIndex(index) - sliceWidth / 2)} y="10" width={Math.max(5, sliceWidth)} height={height - 38} className={styles.chartHitArea} onMouseEnter={() => setHoveredIndex(index)} />;
          })}
          {activePoint ? (
            <g aria-hidden="true">
              <line x1={activeX} x2={activeX} y1="12" y2={height - 30} className={styles.chartGuide} />
              <circle cx={activeX} cy={activeY} r="5" className={styles.chartDot} />
              <g transform={`translate(${tooltipX}, 20)`} className={styles.chartTooltip}><rect width="116" height="48" rx="9" /><text x="10" y="18">{formatDay(activePoint.date)}</text><text x="10" y="37" className={styles.chartTooltipValue}>{formatInteger(activePoint[selected])} {metric.shortLabel.toLowerCase()}</text></g>
            </g>
          ) : null}
        </svg>
        <figcaption><span>Solid: daily</span><span>Dashed: 7D average</span></figcaption>
      </figure>
    </article>
  );
}

function ComparisonPanel({ data }: { data: AnalyticsOverviewResponse }) {
  const rows = SERIES.map((entry) => {
    const trend = data.overview[entry.key];
    const values = data.series.map((point) => point[entry.key]);
    const peak = Math.max(0, ...values);
    const peakIndex = Math.max(0, values.indexOf(peak));
    return { ...entry, trend, average: values.reduce((sum, value) => sum + value, 0) / Math.max(1, data.series.length), peak, peakDay: data.series[peakIndex]?.date || "" };
  });
  const overview = data.overview;
  return (
    <article className={`${styles.panel} ${styles.comparisonPanel}`} id="overview">
      <PanelHeader index="01B" label="Growth" title="Period delta" meta="vs prior" />
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <caption className={styles.srOnly}>Current and previous period comparison</caption>
          <thead><tr><th scope="col">Metric</th><th scope="col">Now</th><th scope="col">Prior</th><th scope="col">Δ</th><th scope="col">Avg/d</th><th scope="col">Peak</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.key}><th scope="row">{row.shortLabel}</th><td>{formatInteger(row.trend.value)}</td><td>{formatInteger(row.trend.previous)}</td><td><TrendBadge trend={row.trend} /></td><td>{formatDecimal(row.average)}</td><td>{formatInteger(row.peak)} <small>{formatDay(row.peakDay)}</small></td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className={styles.baseGrid}>
        <div><span>Total accounts</span><strong>{formatInteger(overview.total_accounts)}</strong></div>
        <div><span>Entitled</span><strong>{formatInteger(overview.entitled_accounts)}</strong></div>
        <div><span>Active paid</span><strong>{formatInteger(overview.active_subscription_accounts)}</strong></div>
        <div><span>Plus / Pro</span><strong>{formatInteger(overview.plans.plus)} / {formatInteger(overview.plans.pro)}</strong></div>
      </div>
    </article>
  );
}

function DistributionBars({ rows, emptyLabel }: { rows: Array<{ label: string; count: number }>; emptyLabel: string }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  if (rows.length === 0) return <p className={styles.emptyRow}>{emptyLabel}</p>;
  return (
    <div className={styles.distribution}>{rows.map((row) => (
      <div className={styles.distributionRow} key={row.label}>
        <div className={styles.distributionMeta}><span>{sentenceCase(row.label)}</span><strong>{formatInteger(row.count)} <small>{formatPercent((row.count / Math.max(1, total)) * 100)}</small></strong></div>
        <div className={styles.distributionTrack} aria-hidden="true"><span style={{ width: `${Math.max(2, (row.count / maximum) * 100)}%` }} /></div>
      </div>
    ))}</div>
  );
}

function RingMetric({ label, value, count }: { label: string; value: number; count: string }) {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, value));
  return (
    <div className={styles.ringMetric}>
      <svg className={styles.ring} viewBox="0 0 64 64" role="img" aria-label={`${label}: ${formatPercent(value)}`}>
        <circle className={styles.ringTrack} cx="32" cy="32" r={radius} />
        <circle
          className={styles.ringProgress}
          cx="32"
          cy="32"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress / 100)}
        />
        <text x="32" y="36" textAnchor="middle">{Math.round(value)}%</text>
      </svg>
      <span>{label}</span><small>{count}</small>
    </div>
  );
}

function JourneyPanel({ data }: { data: AnalyticsOverviewResponse }) {
  const maximum = Math.max(1, ...data.journey.map((stage) => stage.value));
  return (
    <article className={styles.panel} id="journey">
      <PanelHeader index="02" label="Journey" title="Signal ladder" meta="retained base" />
      <ol className={styles.journeyList}>{data.journey.map((stage, index) => (
        <li key={stage.key}>
          <div className={styles.journeyMeta}><span><i>{String(index + 1).padStart(2, "0")}</i>{stage.label}</span><strong>{formatInteger(stage.value)} <small>{formatPercent(stage.conversion_pct)}</small></strong></div>
          <div className={styles.journeyTrack} aria-hidden="true"><span style={{ width: `${Math.max(2, (stage.value / maximum) * 100)}%` }} /></div>
        </li>
      ))}</ol>
    </article>
  );
}

function EngagementPanel({ data }: { data: AnalyticsOverviewResponse }) {
  const engagement = data.engagement;
  return (
    <article className={styles.panel} id="engagement">
      <PanelHeader index="03" label="Engagement" title="Learning quality" meta={`${formatInteger(engagement.reel_starts)} starts`} />
      <div className={styles.ringGrid}>
        <RingMetric label="Completion" value={engagement.start_cohort_completion_rate_pct} count={`${formatInteger(engagement.start_cohort_completions)} cohort`} />
        <RingMetric label="Helpful" value={engagement.helpful_rate_pct} count={`${formatInteger(engagement.helpful)} / ${formatInteger(engagement.confusing)}`} />
        <RingMetric label="Accuracy" value={engagement.assessment_accuracy_pct} count={`${formatInteger(engagement.assessment_correct)} / ${formatInteger(engagement.assessment_attempts)}`} />
      </div>
      <div className={styles.countGrid}>
        <div><span>Completion events</span><strong>{formatInteger(engagement.reel_completions)}</strong></div>
        <div><span>Feedback total</span><strong>{formatInteger(engagement.helpful + engagement.confusing)}</strong></div>
        <div><span>Assessment attempts</span><strong>{formatInteger(engagement.assessment_attempts)}</strong></div>
      </div>
    </article>
  );
}

function MixPanel({ data }: { data: AnalyticsOverviewResponse }) {
  return (
    <article className={styles.panel} id="product-mix">
      <PanelHeader index="03B" label="Engagement" title="Content mix" meta="in window" />
      <div className={styles.mixColumns}>
        <section><h3>Source type</h3><DistributionBars rows={data.content.source_types} emptyLabel="No material sources." /></section>
        <section><h3>Knowledge level</h3><DistributionBars rows={data.content.knowledge_levels} emptyLabel="No levels recorded." /></section>
      </div>
    </article>
  );
}

function PipelinePanel({ data }: { data: AnalyticsOverviewResponse }) {
  const pipeline = data.pipeline;
  const jobTotal = pipeline.jobs.reduce((sum, row) => sum + row.count, 0);
  const colors = ["#f2f2ee", "#b5b5b0", "#777773", "#3a3a38", "#d6d6d1", "#565653"];
  return (
    <article className={`${styles.panel} ${styles.pipelinePanel}`} id="pipeline">
      <PanelHeader index="04" label="Pipeline" title="Generation health" meta={`${formatInteger(jobTotal)} jobs`} />
      <div className={styles.pipelineSummary}>
        <div><span>Queued</span><strong>{formatInteger(pipeline.queue_depth)}</strong></div><div><span>Running</span><strong>{formatInteger(pipeline.running)}</strong></div><div><span>Settled</span><strong>{formatPercent(pipeline.settled_rate_pct)}</strong></div><div><span>Queue p50</span><strong>{formatDuration(pipeline.median_queue_seconds)}</strong></div><div><span>Run p50</span><strong>{formatDuration(pipeline.median_run_seconds)}</strong></div><div><span>Timing n</span><strong>{formatInteger(pipeline.timing_sample_size)}</strong></div>
      </div>
      <div className={styles.stackedBar} aria-label="Backend job outcome share">{pipeline.jobs.map((row, index) => <span key={row.status} style={{ background: colors[index % colors.length], width: `${(row.count / Math.max(1, jobTotal)) * 100}%` }} title={`${sentenceCase(row.status)}: ${formatInteger(row.count)}`} />)}</div>
      <div className={styles.pipelineTables}>
        <section><h3>Job outcomes</h3><table className={styles.compactTable}><caption className={styles.srOnly}>Pipeline job outcomes</caption><thead><tr><th scope="col">Status</th><th scope="col">Count</th><th scope="col">Share</th></tr></thead><tbody>{pipeline.jobs.length ? pipeline.jobs.map((row, index) => <tr key={row.status}><th scope="row"><i style={{ background: colors[index % colors.length] }} />{sentenceCase(row.status)}</th><td>{formatInteger(row.count)}</td><td>{formatPercent((row.count / Math.max(1, jobTotal)) * 100)}</td></tr>) : <tr><td colSpan={3}>No jobs.</td></tr>}</tbody></table></section>
        <section><h3>Source inventory</h3><table className={styles.compactTable}><caption className={styles.srOnly}>Current source inventory</caption><thead><tr><th scope="col">State</th><th scope="col">Count</th></tr></thead><tbody>{pipeline.sources.length ? pipeline.sources.map((row) => <tr key={row.state}><th scope="row">{sentenceCase(row.state)}</th><td>{formatInteger(row.count)}</td></tr>) : <tr><td colSpan={2}>No source work.</td></tr>}</tbody></table></section>
        <section><h3>Failure codes</h3><table className={styles.compactTable}><caption className={styles.srOnly}>Pipeline failure codes</caption><thead><tr><th scope="col">Code</th><th scope="col">Count</th></tr></thead><tbody>{pipeline.failure_codes.length ? pipeline.failure_codes.map((row) => <tr key={row.code}><th scope="row">{sentenceCase(row.code)}</th><td>{formatInteger(row.count)}</td></tr>) : <tr><td colSpan={2}>No failures.</td></tr>}</tbody></table></section>
      </div>
    </article>
  );
}

function EconomicsPanel({ data }: { data: AnalyticsOverviewResponse }) {
  const economics = data.economics;
  const inputShare = economics.total_tokens > 0 ? (economics.input_tokens / economics.total_tokens) * 100 : 0;
  return (
    <article className={`${styles.panel} ${styles.economicsPanel}`} id="economics">
      <PanelHeader index="05" label="Economics" title="Cost & usage" meta={`${formatCompact(economics.total_tokens)} tokens`} />
      <div className={styles.economicsSummary}><div><span>Known cost</span><strong>{formatUsdMicros(economics.settled_known_cost_microusd)}</strong></div><div><span>Cost ceiling</span><strong>{formatUsdMicros(economics.settled_cost_ceiling_microusd)}</strong></div><div><span>Reserved</span><strong>{formatUsdMicros(economics.current_reserved_exposure_microusd)}</strong></div><div><span>Requests</span><strong>{formatInteger(economics.billable_requests)}</strong></div></div>
      <div className={styles.tokenSplit}>
        <div className={styles.tokenSplitMeta}><span>Input <strong>{formatCompact(economics.input_tokens)}</strong></span><span>Output <strong>{formatCompact(economics.output_tokens)}</strong></span><span>Avg/request <strong>{formatCompact(economics.average_tokens_per_token_bearing_request)}</strong></span></div>
        <div className={styles.tokenBar} aria-hidden="true"><span style={{ width: `${inputShare}%` }} /><i /></div>
      </div>
      <div className={styles.economicsTables}>
        <section><h3>Providers</h3><div className={styles.tableWrap}><table className={styles.compactTable}><caption className={styles.srOnly}>Provider usage in the selected UTC window</caption><thead><tr><th scope="col">Provider</th><th scope="col">Requests</th><th scope="col">Tokens</th></tr></thead><tbody>{economics.providers.length ? economics.providers.map((row) => <tr key={row.provider}><th scope="row">{sentenceCase(row.provider)}</th><td>{formatInteger(row.billable_requests)}</td><td>{formatCompact(row.total_tokens)}</td></tr>) : <tr><td colSpan={3}>No provider usage.</td></tr>}</tbody></table></div></section>
        <section><h3>Operations</h3><div className={styles.tableWrap}><table className={styles.compactTable}><caption className={styles.srOnly}>Highest-volume operations in the selected UTC window</caption><thead><tr><th scope="col">Operation</th><th scope="col">Requests</th><th scope="col">Tokens</th></tr></thead><tbody>{economics.operations.length ? economics.operations.map((row) => <tr key={row.operation}><th scope="row">{sentenceCase(row.operation)}</th><td>{formatInteger(row.billable_requests)}</td><td>{formatCompact(row.total_tokens)}</td></tr>) : <tr><td colSpan={3}>No operation usage.</td></tr>}</tbody></table></div></section>
      </div>
    </article>
  );
}

function DailyLedger({ data }: { data: AnalyticsOverviewResponse }) {
  const maxima = {
    new_accounts: Math.max(1, ...data.series.map((point) => point.new_accounts)),
    consumed_search_accounts: Math.max(1, ...data.series.map((point) => point.consumed_search_accounts)),
    consumed_searches: Math.max(1, ...data.series.map((point) => point.consumed_searches)),
    released_reels: Math.max(1, ...data.series.map((point) => point.released_reels)),
  };
  const cell = (value: number, maximum: number) => <span className={styles.ledgerCell}><i style={{ width: `${(value / maximum) * 100}%` }} aria-hidden="true" /><strong>{formatInteger(value)}</strong></span>;
  return (
    <article className={`${styles.panel} ${styles.dailyPanel}`} id="daily">
      <PanelHeader index="06" label="Daily data" title="UTC ledger" meta={`${data.series.length} rows · newest first`} />
      <div className={styles.dailyTableWrap}>
        <table className={`${styles.dataTable} ${styles.dailyTable}`}>
          <caption className={styles.srOnly}>Daily activity ledger</caption>
          <thead><tr><th scope="col">UTC day</th><th scope="col">Accounts</th><th scope="col">Search users</th><th scope="col">Searches</th><th scope="col">Reels</th><th scope="col">Searches / user</th><th scope="col">Reels / search</th></tr></thead>
          <tbody>{[...data.series].reverse().map((point) => (
            <tr key={point.date}><th scope="row">{formatDay(point.date)} <small>{point.date}</small></th><td>{cell(point.new_accounts, maxima.new_accounts)}</td><td>{cell(point.consumed_search_accounts, maxima.consumed_search_accounts)}</td><td>{cell(point.consumed_searches, maxima.consumed_searches)}</td><td>{cell(point.released_reels, maxima.released_reels)}</td><td>{point.consumed_search_accounts > 0 ? formatDecimal(point.consumed_searches / point.consumed_search_accounts) : "—"}</td><td>{point.consumed_searches > 0 ? formatPercent((point.released_reels / point.consumed_searches) * 100) : "—"}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </article>
  );
}

function DefinitionPanel({ data }: { data: AnalyticsOverviewResponse }) {
  const definitions = [data.definitions.scope, data.definitions.consumed_search_accounts, data.definitions.consumed_searches, data.definitions.released_reels, data.definitions.subscriptions, data.definitions.estimated_plan_value, data.definitions.engagement, data.definitions.tracked_openai_cost, data.definitions.pipeline_timing];
  return (
    <details className={styles.definitionPanel}>
      <summary>Definitions & caveats <span>{definitions.length} notes</span></summary>
      <div className={styles.definitionGrid}>{definitions.map((definition, index) => <p key={index}><i>{String(index + 1).padStart(2, "0")}</i>{definition}</p>)}</div>
    </details>
  );
}

function Dashboard({ data }: { data: AnalyticsOverviewResponse }) {
  const overview = data.overview;
  const engagement = data.engagement;
  const pipeline = data.pipeline;
  const economics = data.economics;
  const periodNewAccounts = sumSeries(data.series, "new_accounts");
  let runningBase = Math.max(0, overview.total_accounts - periodNewAccounts);
  const accountBaseSeries = data.series.map((point) => { runningBase += point.new_accounts; return runningBase; });
  const trends: Record<SeriesKey, AnalyticsTrend> = {
    new_accounts: overview.new_accounts,
    consumed_search_accounts: overview.consumed_search_accounts,
    consumed_searches: overview.consumed_searches,
    released_reels: overview.released_reels,
  };

  return (
    <div className={styles.dashboard}>
      <section className={styles.signalGrid} aria-label="Key product signals">
        <SignalCard label="Total accounts" value={formatInteger(overview.total_accounts)} note={`+${formatInteger(periodNewAccounts)} in range`} series={accountBaseSeries} />
        <SignalCard label="New accounts" value={formatInteger(overview.new_accounts.value)} note={`${formatInteger(overview.new_accounts.previous)} prior`} trend={overview.new_accounts} series={data.series.map((point) => point.new_accounts)} />
        <SignalCard label="Search users" value={formatInteger(overview.consumed_search_accounts.value)} note={`${formatInteger(overview.consumed_search_accounts.previous)} prior`} trend={overview.consumed_search_accounts} series={data.series.map((point) => point.consumed_search_accounts)} />
        <SignalCard label="Consumed searches" value={formatInteger(overview.consumed_searches.value)} note={`${formatInteger(overview.consumed_searches.previous)} prior`} trend={overview.consumed_searches} series={data.series.map((point) => point.consumed_searches)} />
        <SignalCard label="Released reels" value={formatInteger(overview.released_reels.value)} note={`${formatInteger(overview.released_reels.previous)} prior`} trend={overview.released_reels} series={data.series.map((point) => point.released_reels)} />
        <SignalCard label="Active paid" value={formatInteger(overview.active_subscription_accounts)} note={`${formatInteger(overview.entitled_accounts)} entitled`} progress={(overview.active_subscription_accounts / Math.max(1, overview.entitled_accounts)) * 100} />
        <SignalCard label="Monthly plan value" value={formatUsdCents(overview.estimated_plan_value_cents)} note={`${formatInteger(overview.plans.plus)} Plus · ${formatInteger(overview.plans.pro)} Pro`} />
        <SignalCard label="Completion" value={formatPercent(engagement.start_cohort_completion_rate_pct)} note={`${formatInteger(engagement.start_cohort_completions)} / ${formatInteger(engagement.reel_starts)}`} progress={engagement.start_cohort_completion_rate_pct} />
        <SignalCard label="Helpful" value={formatPercent(engagement.helpful_rate_pct)} note={`${formatInteger(engagement.helpful)} / ${formatInteger(engagement.helpful + engagement.confusing)}`} progress={engagement.helpful_rate_pct} />
        <SignalCard label="Quiz accuracy" value={formatPercent(engagement.assessment_accuracy_pct)} note={`${formatInteger(engagement.assessment_correct)} / ${formatInteger(engagement.assessment_attempts)}`} progress={engagement.assessment_accuracy_pct} />
        <SignalCard label="Queue now" value={formatInteger(pipeline.queue_depth)} note={`${formatInteger(pipeline.running)} running · ${formatPercent(pipeline.settled_rate_pct)} settled`} />
        <SignalCard label="Known OpenAI cost" value={formatUsdMicros(economics.settled_known_cost_microusd)} note={`${formatUsdMicros(economics.current_reserved_exposure_microusd)} reserved`} />
      </section>
      <section className={styles.overviewGrid} aria-label="Growth overview"><ActivityChart points={data.series} trends={trends} /><ComparisonPanel data={data} /></section>
      <section className={styles.liveStrip} aria-label="Live and window health signals">
        <div><span>Queue</span><strong>{formatInteger(pipeline.queue_depth)}</strong></div><div><span>Running</span><strong>{formatInteger(pipeline.running)}</strong></div><div><span>Settled</span><strong>{formatPercent(pipeline.settled_rate_pct)}</strong></div><div><span>Queue p50</span><strong>{formatDuration(pipeline.median_queue_seconds)}</strong></div><div><span>Run p50</span><strong>{formatDuration(pipeline.median_run_seconds)}</strong></div><div><span>Completion</span><strong>{formatPercent(engagement.start_cohort_completion_rate_pct)}</strong></div><div><span>Helpful</span><strong>{formatPercent(engagement.helpful_rate_pct)}</strong></div><div><span>Accuracy</span><strong>{formatPercent(engagement.assessment_accuracy_pct)}</strong></div>
      </section>
      <section className={styles.middleGrid} aria-label="Product behavior"><JourneyPanel data={data} /><EngagementPanel data={data} /><MixPanel data={data} /></section>
      <section className={styles.lowerGrid} aria-label="Operations and economics"><PipelinePanel data={data} /><EconomicsPanel data={data} /></section>
      <DailyLedger data={data} />
      <DefinitionPanel data={data} />
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className={styles.loadingGrid} role="status" aria-live="polite">
      {Array.from({ length: 12 }, (_, index) => <span key={index} className={styles.loadingCard} />)}
      <span className={styles.loadingWide} /><span className={styles.loadingSide} /><span className={styles.srOnly}>Reading retained product records</span>
    </div>
  );
}

async function fetchOverview(days: AnalyticsRangeDays, signal: AbortSignal): Promise<AnalyticsOverviewResponse> {
  const response = await fetch(`/api/overview?days=${days}`, { cache: "no-store", credentials: "same-origin", signal });
  if (response.status === 401) { window.location.replace("/login"); throw new Error("Your private session expired."); }
  if (!response.ok) throw new Error("The analytics read could not be completed.");
  const overview = await response.json() as AnalyticsOverviewResponse;
  if (!overview || typeof overview !== "object" || !overview.overview || !Array.isArray(overview.series) || !Array.isArray(overview.journey)) throw new Error("The analytics service returned an invalid response.");
  return overview;
}

export default function DashboardClient() {
  const [days, setDays] = useState<AnalyticsRangeDays>(30);
  const [data, setData] = useState<AnalyticsOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const rangeLabel = useMemo(() => data ? `${formatDay(data.range.start_date)}–${formatDay(data.range.end_date)}` : `${days}D UTC`, [data, days]);

  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);
    setError(null);
    void fetchOverview(days, controller.signal)
      .then((response) => { if (!controller.signal.aborted) setData(response); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Analytics could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [days, refreshRevision]);

  return (
    <div className={styles.shell} aria-busy={refreshing}>
      <header className={styles.topbar}>
        <a href="#overview" className={styles.brand} aria-label="Nosca analytics overview"><Image src="/nosca-logo.svg" alt="" width={27} height={32} priority /><span><strong>Nosca</strong><small>ANALYTICS</small></span></a>
        <nav className={styles.nav} aria-label="Dashboard sections"><a href="#overview">Overview</a><a href="#growth">Growth</a><a href="#journey">Journey</a><a href="#pipeline">Pipeline</a><a href="#economics">Cost</a><a href="#daily">Daily</a></nav>
        <div className={styles.topbarActions}>
          <div className={styles.syncState} title={data ? `Updated ${formatGeneratedAt(data.generated_at)}` : "Reading data"}><i className={refreshing ? styles.syncing : undefined} aria-hidden="true" /><span><strong>{rangeLabel}</strong><small>{refreshing ? "SYNCING" : "POSTGRES · LIVE"}</small></span></div>
          <div className={styles.rangeControl} role="group" aria-label="Analytics date range">{RANGE_DAYS.map((range) => (
            <button key={range} type="button" aria-label={`Show the last ${range} days`} aria-pressed={days === range} className={days === range ? styles.rangeActive : undefined} onClick={() => { if (range !== days) setData(null); setDays(range); }}>{range}D</button>
          ))}</div>
          <button type="button" className={styles.iconButton} disabled={refreshing} onClick={() => setRefreshRevision((revision) => revision + 1)} aria-label="Refresh analytics" title="Refresh"><span className={refreshing ? styles.refreshing : undefined} aria-hidden="true">↻</span></button>
          {PRODUCT_URL ? <a href={PRODUCT_URL} className={styles.appLink}>App ↗</a> : null}
          <LogoutButton className={styles.signOutButton}>Sign out</LogoutButton>
        </div>
      </header>
      <main className={styles.main}>
        <h1 className={styles.srOnly}>Nosca analytics</h1>
        {error ? <div className={styles.errorBanner} role="alert"><span><strong>Read failed</strong>{error}</span><button type="button" onClick={() => setRefreshRevision((revision) => revision + 1)}>Retry</button></div> : null}
        {!data && refreshing ? <LoadingPanel /> : null}
        {data ? <Dashboard data={data} /> : null}
      </main>
      <footer className={styles.footer}><span>PRIVATE OWNER SURFACE</span><span>Retained database · UTC · no account-level rows</span></footer>
    </div>
  );
}

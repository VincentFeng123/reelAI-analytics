import type {
  AnalyticsRangeDays,
  AnalyticsTrend,
} from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateFromUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addUtcDays(value: string, days: number): string {
  return utcDay(new Date(dateFromUtcDay(value).getTime() + days * DAY_MS));
}

export function analyticsWindow(days: AnalyticsRangeDays, now = new Date()) {
  const endDate = utcDay(now);
  const startDate = addUtcDays(endDate, -(days - 1));
  const previousEndDate = addUtcDays(startDate, -1);
  const previousStartDate = addUtcDays(previousEndDate, -(days - 1));
  return {
    startDate,
    endDate,
    endExclusive: addUtcDays(endDate, 1),
    previousStartDate,
    previousEndDate,
    previousEndExclusive: addUtcDays(previousEndDate, 1),
  };
}

export function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function trend(value: number, previous: number): AnalyticsTrend {
  return {
    value,
    previous,
    change_pct:
      previous > 0
        ? Math.round(((value - previous) / previous) * 1000) / 10
        : null,
  };
}

export function elapsedSeconds(
  rawStart: unknown,
  rawEnd: unknown,
): number | null {
  const start = new Date(String(rawStart || ""));
  const end = new Date(String(rawEnd || ""));
  if (
    Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || end < start
  ) {
    return null;
  }
  return (end.getTime() - start.getTime()) / 1000;
}

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const value = ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
  return Math.round(value * 10) / 10;
}

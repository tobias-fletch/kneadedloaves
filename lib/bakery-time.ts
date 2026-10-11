/** All bakery scheduling uses this zone, regardless of server or browser timezone. */
export const BAKERY_TIME_ZONE = "America/New_York";

const localPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BAKERY_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function localParts(date: Date): LocalParts {
  if (!Number.isFinite(date.getTime())) throw new Error("Enter a valid date and time.");
  const parts = Object.fromEntries(localPartsFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second)
  };
}

function wallClockTimestamp(parts: LocalParts) {
  // setUTCFullYear avoids Date.UTC treating years 0–99 as 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

/** Parse a datetime-local value without relying on the host timezone or Date's rollover. */
export function parseBakeryDateTime(value: unknown, label = "Date and time"): Date {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`${label} must be a local date and time in ${BAKERY_TIME_ZONE}.`);
  const [, year, month, day, hour, minute, second = "0"] = match;
  const requested = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second) };
  const wallTime = wallClockTimestamp(requested);
  const calendar = new Date(wallTime);
  if (requested.year < 1 || calendar.getUTCFullYear() !== requested.year || calendar.getUTCMonth() + 1 !== requested.month || calendar.getUTCDate() !== requested.day || calendar.getUTCHours() !== requested.hour || calendar.getUTCMinutes() !== requested.minute || calendar.getUTCSeconds() !== requested.second) {
    throw new Error(`${label} is not a valid calendar date and time.`);
  }

  // Discover both offsets around a transition, then keep only exact round-trips.
  // Zero matches is a spring-forward gap; two matches is a fall-back overlap.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = wallTime + hours * 60 * 60 * 1000;
    offsets.add(wallClockTimestamp(localParts(new Date(instant))) - instant);
  }
  const matches = [...offsets].map((offset) => new Date(wallTime - offset)).filter((candidate) => {
    const parts = localParts(candidate);
    return (Object.keys(requested) as (keyof LocalParts)[]).every((key) => parts[key] === requested[key]);
  });
  if (!matches.length) throw new Error(`${label} does not exist in ${BAKERY_TIME_ZONE} because clocks move forward. Choose another time.`);
  if (matches.length > 1) throw new Error(`${label} is ambiguous in ${BAKERY_TIME_ZONE} because clocks move back. Choose another time.`);
  return matches[0];
}

export function bakeryDateKey(date: Date): string {
  const { year, month, day } = localParts(date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function bakeryCalendarDay(date: Date): number {
  const parts = localParts(date);
  return wallClockTimestamp({ ...parts, hour: 0, minute: 0, second: 0 }) / 86400000;
}

export function bakeryWeekday(date: Date): number {
  return new Date(bakeryCalendarDay(date) * 86400000).getUTCDay();
}

export function toBakeryDateTimeLocal(date: Date): string {
  const parts = localParts(date);
  return `${bakeryDateKey(date)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
}

export function formatBakeryDate(value: Date | string, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: BAKERY_TIME_ZONE }).format(typeof value === "string" ? new Date(value) : value);
}

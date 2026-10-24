/** Eastern Time wall clock for customer-facing dates. The zone is explicit so the server TZ cannot change the result, including across DST. */
const EASTERN_TIME = "America/New_York";

function requireDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("A valid date is required.");
  return value;
}

function easternParts(value: Date, options: Intl.DateTimeFormatOptions) {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of new Intl.DateTimeFormat("en-US", { ...options, timeZone: EASTERN_TIME }).formatToParts(value)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return parts;
}

/** Fulfillment day, e.g. "Sunday, October 25". */
export function formatFulfillmentDate(value: Date) {
  const parts = easternParts(requireDate(value), { weekday: "long", month: "long", day: "numeric" });
  return `${parts.weekday}, ${parts.month} ${parts.day}`;
}

/** Deadline or hold expiry, e.g. "Saturday, Oct 24 at 9:00 PM ET". */
export function formatDeadline(value: Date) {
  const parts = easternParts(requireDate(value), {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  const period = (parts.dayPeriod ?? "").replace(/[\s.]/g, "").toUpperCase();
  if (period !== "AM" && period !== "PM") throw new Error("Could not format the Eastern Time hour.");
  return `${parts.weekday}, ${parts.month} ${parts.day} at ${parts.hour}:${parts.minute} ${period} ET`;
}

function easternHour12(value: Date) {
  const parts = easternParts(requireDate(value), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const period = (parts.dayPeriod ?? "").replace(/[\s.]/g, "").toUpperCase();
  if (period !== "AM" && period !== "PM") throw new Error("Could not format the Eastern Time hour.");
  return { month: parts.month, day: parts.day, time: `${parts.hour}:${parts.minute} ${period}` };
}

/** Window open/close time, e.g. "Oct 24, 9:00 PM ET". */
export function formatEasternDateTime(value: Date) {
  const parts = easternHour12(value);
  return `${parts.month} ${parts.day}, ${parts.time} ET`;
}

/** Short Eastern calendar day, e.g. "Sunday, Oct 25". */
export function formatEasternDay(value: Date) {
  const parts = easternParts(requireDate(value), { weekday: "long", month: "short", day: "numeric" });
  return `${parts.weekday}, ${parts.month} ${parts.day}`;
}

/** Eastern weekday name, e.g. "Sunday". */
export function formatEasternWeekday(value: Date) {
  return easternParts(requireDate(value), { weekday: "long" }).weekday ?? "";
}

/** Eastern month and day, e.g. "Oct 25". */
export function formatEasternMonthDay(value: Date) {
  const parts = easternParts(requireDate(value), { month: "short", day: "numeric" });
  return `${parts.month} ${parts.day}`;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function easternWallClock(value: Date) {
  const parts = easternParts(requireDate(value), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

/** Value for an <input type="datetime-local"> showing the Eastern wall clock, e.g. "2026-10-24T21:00". */
export function toEasternDateTimeLocal(value: Date) {
  const wall = easternWallClock(value);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** Minutes Eastern Time is ahead of UTC at an instant (negative: -240 in EDT, -300 in EST). */
function easternOffsetMinutes(instantMs: number) {
  const wall = easternWallClock(new Date(instantMs));
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return Math.round((wallAsUtc - Math.floor(instantMs / 60000) * 60000) / 60000);
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Reads a date-time typed in the admin (datetime-local, no zone) as an America/New_York wall-clock time
 * and returns the matching instant. The server time zone is never consulted.
 * - Fall-back hour (e.g. 1:30 AM on Nov 1, 2026 happens twice): the first (EDT) occurrence is used.
 * - Spring-forward gap (e.g. 2:30 AM on Mar 14, 2027 never happens): rejected so the admin picks a real time.
 * Strings that already carry a zone (ending in Z or +hh:mm) are read as-is for API callers.
 */
export function parseEasternDateTimeLocal(input: unknown) {
  const text = typeof input === "string" ? input.trim() : "";
  if (text && HAS_ZONE.test(text) && text.includes("T")) {
    const instant = new Date(text);
    if (Number.isNaN(instant.getTime())) throw new Error("Enter a valid date and time.");
    return instant;
  }
  const match = LOCAL_DATE_TIME.exec(text);
  if (!match) throw new Error("Enter a valid date and time.");
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const wallCheck = new Date(wallAsUtc);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || wallCheck.getUTCDate() !== day || wallCheck.getUTCMonth() !== month - 1) {
    throw new Error("Enter a valid date and time.");
  }
  const offsets = new Set([-86_400_000, 0, 86_400_000].map((shift) => easternOffsetMinutes(wallAsUtc + shift)));
  const matches = [...offsets]
    .map((offset) => wallAsUtc - offset * 60_000)
    .filter((candidate) => {
      const wall = easternWallClock(new Date(candidate));
      return wall.year === year && wall.month === month && wall.day === day && wall.hour === hour && wall.minute === minute;
    })
    .sort((a, b) => a - b);
  if (!matches.length) throw new Error("That time does not exist in Eastern Time (clocks spring forward). Pick a time after 3:00 AM.");
  return new Date(matches[0]);
}

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

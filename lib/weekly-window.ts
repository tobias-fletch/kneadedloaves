/**
 * Weekly order window math. Pure functions only (no database), so they can be unit tested.
 *
 * Every day/time here is an America/New_York wall clock. Instants are built with
 * parseEasternDateTimeLocal from PR #15, so DST is handled the same way as the admin forms:
 * - Fall-back repeated hour (e.g. 1:30 AM on Nov 1, 2026): the first (EDT) occurrence.
 * - Spring-forward gap (e.g. 2:30 AM on Mar 14, 2027 never happens): the schedule moves
 *   forward by one hour to the first real time (3:30 AM EDT) instead of failing.
 */
import { formatEasternMonthDay, parseEasternDateTimeLocal } from "@/lib/format-datetime";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type WeeklySchedule = {
  openWeekday: number;
  openTime: string;
  closeWeekday: number;
  closeTime: string;
  fulfillmentWeekday: number;
};

export type WeeklySettings = WeeklySchedule & {
  enabled: boolean;
  windowName: string;
  maxOrders: number | null;
  paused: boolean;
  pauseMessage: string | null;
};

/**
 * Defaults match the bakery's current week: orders close Saturday 9:00 PM ET and are
 * fulfilled Sunday. enabled = false, so nothing changes until the owner turns it on.
 * The open day/time is an assumption (Monday 9:00 AM ET) the owner should confirm.
 */
export const DEFAULT_WEEKLY_SETTINGS: WeeklySettings = {
  enabled: false,
  windowName: "Weekly Bake",
  openWeekday: 1,
  openTime: "09:00",
  closeWeekday: 6,
  closeTime: "21:00",
  fulfillmentWeekday: 0,
  maxOrders: null,
  paused: false,
  pauseMessage: null
};

export type WeekOverride = {
  opensAt?: Date | null;
  closesAt?: Date | null;
  fulfillmentDate?: Date | null;
  skip?: boolean;
  message?: string | null;
};

export type WeekWindow = {
  weekKey: string;
  opensAt: Date;
  closesAt: Date;
  fulfillmentDate: Date;
  overridden: boolean;
  message: string | null;
};

export type WeeklyResolution =
  | { status: "paused"; message: string | null; current: null; next: null; notice: null }
  | { status: "open"; current: WeekWindow; next: null; message: null; notice: string | null }
  | { status: "closed"; current: null; next: WeekWindow | null; message: null; notice: string | null };

const DAY_MS = 86_400_000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEK_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, "0");

type CivilDate = { year: number; month: number; day: number };

function civilFromKey(weekKey: string): CivilDate {
  const match = WEEK_KEY.exec(weekKey);
  if (!match) throw new Error("Invalid week.");
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error("Invalid week.");
  return { year, month, day };
}

function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function weekdayOf(date: CivilDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function keyOf(date: CivilDate) {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** The Eastern calendar date of an instant. */
export function easternCivilDate(value: Date): CivilDate {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function parseTimeOfDay(value: string) {
  const match = TIME.exec(value);
  if (!match) throw new Error("Use a time like 21:00.");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Eastern wall clock -> instant. Spring-forward gap times move one hour later. */
export function easternInstant(date: CivilDate, time: string): Date {
  const { hour, minute } = parseTimeOfDay(time);
  const text = (h: number) => `${keyOf(date)}T${pad(h)}:${pad(minute)}`;
  try {
    return parseEasternDateTimeLocal(text(hour));
  } catch {
    return parseEasternDateTimeLocal(text(Math.min(hour + 1, 23)));
  }
}

/** The scheduled (non-overridden) window for the week whose scheduled close falls on weekKey. */
export function scheduledWeek(schedule: WeeklySchedule, weekKey: string): Omit<WeekWindow, "overridden" | "message"> {
  const closeDate = civilFromKey(weekKey);
  if (weekdayOf(closeDate) !== schedule.closeWeekday) throw new Error("That week does not match the close day.");
  const closesAt = easternInstant(closeDate, schedule.closeTime);
  let openBack = (schedule.closeWeekday - schedule.openWeekday + 7) % 7;
  if (openBack === 0 && schedule.openTime >= schedule.closeTime) openBack = 7;
  const opensAt = easternInstant(addDays(closeDate, -openBack), schedule.openTime);
  // Fulfillment is the first fulfillment weekday on or after the close date, stored at noon ET.
  const fulfillAhead = (schedule.fulfillmentWeekday - schedule.closeWeekday + 7) % 7;
  const fulfillmentDate = easternInstant(addDays(closeDate, fulfillAhead), "12:00");
  return { weekKey, opensAt, closesAt, fulfillmentDate };
}

/** Week keys (scheduled close dates) from `before` weeks ago to `after` weeks ahead of `now`. */
export function weekKeysAround(schedule: WeeklySchedule, now: Date, before = 2, after = 3) {
  const today = easternCivilDate(now);
  const firstClose = addDays(today, (schedule.closeWeekday - weekdayOf(today) + 7) % 7);
  const keys: string[] = [];
  for (let week = -before; week <= after; week += 1) keys.push(keyOf(addDays(firstClose, week * 7)));
  return keys;
}

/** Upcoming week keys for the admin list, starting with the week that is current or next. */
export function upcomingWeekKeys(schedule: WeeklySchedule, now: Date, count = 6) {
  const keys = weekKeysAround(schedule, now, 1, count);
  return keys.filter((key) => scheduledWeek(schedule, key).closesAt.getTime() >= now.getTime()).slice(0, count);
}

export function applyOverride(schedule: WeeklySchedule, weekKey: string, override?: WeekOverride | null): WeekWindow & { skip: boolean } {
  const base = scheduledWeek(schedule, weekKey);
  const overridden = Boolean(override && (override.opensAt || override.closesAt || override.fulfillmentDate || override.skip));
  return {
    weekKey,
    opensAt: override?.opensAt ?? base.opensAt,
    closesAt: override?.closesAt ?? base.closesAt,
    fulfillmentDate: override?.fulfillmentDate ?? base.fulfillmentDate,
    overridden,
    message: override?.message?.trim() || null,
    skip: Boolean(override?.skip)
  };
}

/**
 * Which window applies at `now`. The current window is the one with opensAt <= now <= closesAt
 * (the close minute is inclusive, like acceptsOrders). Otherwise the next one to open.
 * Rollover needs no cron: once a close passes, the next week is simply the next candidate.
 */
export function resolveWeeklyWindow(settings: WeeklySettings, overrides: Map<string, WeekOverride>, now = new Date()): WeeklyResolution {
  if (settings.paused) return { status: "paused", message: settings.pauseMessage?.trim() || null, current: null, next: null, notice: null };
  const at = now.getTime();
  const weeks = weekKeysAround(settings, now).map((key) => applyOverride(settings, key, overrides.get(key)));
  const live = weeks.filter((week) => week.closesAt.getTime() >= at && week.closesAt.getTime() > week.opensAt.getTime());
  const usable = live.filter((week) => !week.skip);
  const current = usable.filter((week) => week.opensAt.getTime() <= at).sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime())[0];
  const strip = (week: WeekWindow & { skip: boolean }): WeekWindow => ({ weekKey: week.weekKey, opensAt: week.opensAt, closesAt: week.closesAt, fulfillmentDate: week.fulfillmentDate, overridden: week.overridden, message: week.message });
  if (current) return { status: "open", current: strip(current), next: null, message: null, notice: null };
  const next = usable.filter((week) => week.opensAt.getTime() > at).sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime())[0];
  const skipped = live.filter((week) => week.skip && (!next || week.closesAt.getTime() <= next.closesAt.getTime())).sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime())[0];
  const notice = skipped ? skipped.message ?? `No orders the week of ${formatEasternMonthDay(skipped.fulfillmentDate)}.` : null;
  return { status: "closed", current: null, next: next ? strip(next) : null, message: null, notice };
}

function easternShort(value: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    .formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const period = String(parts.dayPeriod ?? "").replace(/[\s.]/g, "").toUpperCase();
  return { weekday: parts.weekday as string, monthDay: `${parts.month} ${parts.day}`, time: `${parts.hour}:${parts.minute} ${period}` };
}

function easternFulfillment(value: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" })
    .formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.weekday}, ${parts.month} ${parts.day}`;
}

/** "Sat, Oct 24 at 9:00 PM ET" */
export function formatWindowMoment(value: Date) {
  const parts = easternShort(value);
  return `${parts.weekday}, ${parts.monthDay} at ${parts.time} ET`;
}

/** One customer-facing sentence for the homepage and checkout. */
export function describeWeeklyWindow(resolution: WeeklyResolution): { headline: string; detail: string | null } {
  if (resolution.status === "paused") {
    return { headline: "Ordering is paused.", detail: resolution.message };
  }
  if (resolution.status === "open") {
    const { current } = resolution;
    return {
      headline: `Orders open until ${formatWindowMoment(current.closesAt)} for ${easternFulfillment(current.fulfillmentDate)} pickup or delivery.`,
      detail: current.message
    };
  }
  if (!resolution.next) return { headline: "Ordering is closed. The next window will be announced soon.", detail: resolution.notice };
  const { next } = resolution;
  return {
    headline: `Next orders open ${formatWindowMoment(next.opensAt)}, until ${formatWindowMoment(next.closesAt)}, for ${easternFulfillment(next.fulfillmentDate)} pickup or delivery.`,
    detail: resolution.notice ?? next.message
  };
}

export function weekdayLabel(day: number, short = false) {
  return (short ? SHORT_WEEKDAYS : WEEKDAYS)[day] ?? "";
}

/** Validates the admin weekly settings form. Throws a plain-language Error. */
export function parseWeeklySettings(body: Record<string, unknown>): WeeklySettings {
  const day = (key: string, label: string) => {
    const value = Number(body[key]);
    if (!Number.isInteger(value) || value < 0 || value > 6) throw new Error(`${label}: pick a day of the week.`);
    return value;
  };
  const time = (key: string, label: string) => {
    const value = String(body[key] ?? "").trim();
    try { parseTimeOfDay(value); } catch { throw new Error(`${label}: use a time like 21:00.`); }
    return value;
  };
  const bool = (key: string) => body[key] === true || body[key] === "true" || body[key] === "on";
  const settings: WeeklySettings = {
    enabled: bool("enabled"),
    windowName: String(body.windowName ?? "").trim().slice(0, 80) || DEFAULT_WEEKLY_SETTINGS.windowName,
    openWeekday: day("openWeekday", "Open day"),
    openTime: time("openTime", "Open time"),
    closeWeekday: day("closeWeekday", "Close day"),
    closeTime: time("closeTime", "Close time"),
    fulfillmentWeekday: day("fulfillmentWeekday", "Fulfillment day"),
    maxOrders: null,
    paused: bool("paused"),
    pauseMessage: String(body.pauseMessage ?? "").trim().slice(0, 300) || null
  };
  const max = body.maxOrders;
  if (max !== undefined && max !== null && max !== "") {
    const parsed = Number(max);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Max orders must be a whole number of at least 1, or blank for no limit.");
    settings.maxOrders = parsed;
  }
  if (settings.openWeekday === settings.closeWeekday && settings.openTime === settings.closeTime) throw new Error("Open and close can't be the same day and time.");
  return settings;
}

export function isWeekKey(value: string) {
  try { civilFromKey(value); return true; } catch { return false; }
}

/** Why checkout refused an order, for the server response. Legacy mode keeps its old wording. */
export function checkoutClosedMessage(resolution: WeeklyResolution | null) {
  if (!resolution) return "Ordering is currently closed or full.";
  if (resolution.status === "paused") return resolution.message ? `Ordering is paused. ${resolution.message}` : "Ordering is paused.";
  if (resolution.status === "open") return "This week's orders are full.";
  return resolution.next ? `Ordering is closed. Next orders open ${formatWindowMoment(resolution.next.opensAt)}.` : "Ordering is closed. The next window will be announced soon.";
}

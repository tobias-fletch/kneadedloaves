import { bakeryCalendarDay, bakeryWeekday, parseBakeryDateTime } from "./bakery-time";

export function cartOwner(userId?: string, sessionId?: string) {
  if (userId) return { userId };
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) return { sessionId };
  return null;
}

export type OrderWindowRules = {
  manualClosed: boolean;
  manualOpen: boolean;
  opensAt: Date;
  closesAt: Date;
  fulfillmentDate: Date;
  maxOrders: number | null;
};

export function orderWindowConfigurationError(window: OrderWindowRules): string | null {
  if (![window.opensAt, window.closesAt, window.fulfillmentDate].every((date) => date instanceof Date && Number.isFinite(date.getTime()))) return "Enter valid opening, cutoff, and delivery dates.";
  if (window.opensAt >= window.closesAt) return "Orders must open before the cutoff.";
  if (window.closesAt >= window.fulfillmentDate) return "The cutoff must be before delivery.";
  if (!Number.isInteger(window.maxOrders) || window.maxOrders === null || window.maxOrders < 1 || window.maxOrders > 2147483647) return "Set a positive whole-number order capacity before opening checkout.";
  const fulfillmentDay = bakeryWeekday(window.fulfillmentDate);
  if (fulfillmentDay !== 6 && fulfillmentDay !== 0) return "Delivery must be on a Saturday or Sunday in America/New_York.";
  if (bakeryCalendarDay(window.fulfillmentDate) - bakeryCalendarDay(window.closesAt) !== 2) return "Saturday delivery requires a Thursday cutoff; Sunday delivery requires a Friday cutoff in the same week.";
  if (window.manualOpen && window.manualClosed) return "A window cannot be both manually open and manually closed.";
  return null;
}

export function acceptsOrders(window: OrderWindowRules, count: number, now = new Date()) {
  if (orderWindowConfigurationError(window) || !Number.isFinite(now.getTime()) || !Number.isInteger(count) || count < 0) return false;
  // Manual open is an early-opening override only. A cutoff is always exclusive.
  return !window.manualClosed && now < window.closesAt && now < window.fulfillmentDate &&
    (window.manualOpen || window.opensAt <= now) && count < window.maxOrders!;
}

function parseBoolean(value: unknown, label: string): boolean {
  if (value === true || value === "true" || value === "on") return true;
  if (value === false || value === "false" || value === "") return false;
  throw new Error(`${label} must be true or false.`);
}

/** Create or patch a schedule; incoming times are explicitly bakery-local values. */
export function parseOrderWindowInput(input: Record<string, unknown>, existing?: OrderWindowRules & { name: string }) {
  const name = input.name === undefined ? existing?.name : input.name;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) throw new Error("Enter a window name between 1 and 120 characters.");
  const capacityInput = input.maxOrders === undefined ? existing?.maxOrders : input.maxOrders;
  const maxOrders = typeof capacityInput === "number" ? capacityInput : typeof capacityInput === "string" && /^\d+$/.test(capacityInput.trim()) ? Number(capacityInput) : null;
  const data = {
    name: name.trim(),
    opensAt: input.opensAt === undefined && existing ? existing.opensAt : parseBakeryDateTime(input.opensAt, "Opening time"),
    closesAt: input.closesAt === undefined && existing ? existing.closesAt : parseBakeryDateTime(input.closesAt, "Cutoff time"),
    fulfillmentDate: input.fulfillmentDate === undefined && existing ? existing.fulfillmentDate : parseBakeryDateTime(input.fulfillmentDate, "Delivery time"),
    maxOrders,
    manualOpen: input.manualOpen === undefined ? existing?.manualOpen ?? false : parseBoolean(input.manualOpen, "Manual opening"),
    manualClosed: input.manualClosed === undefined ? existing?.manualClosed ?? false : parseBoolean(input.manualClosed, "Manual closure")
  };
  const error = orderWindowConfigurationError(data);
  if (error) throw new Error(error);
  return { ...data, maxOrders: data.maxOrders! };
}

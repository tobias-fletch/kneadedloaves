import { parseEasternDateTimeLocal } from "@/lib/format-datetime";

type WindowTimes = { opensAt?: Date; closesAt?: Date; fulfillmentDate?: Date };
const LABELS = { opensAt: "Opens", closesAt: "Closes", fulfillmentDate: "Delivery/pickup date" } as const;

/** Admin-entered window times are Eastern Time. Only fields present in the body are parsed (PATCH-friendly). */
export function parseWindowTimes(body: Record<string, unknown>, required: boolean): WindowTimes {
  const times: WindowTimes = {};
  for (const key of Object.keys(LABELS) as (keyof typeof LABELS)[]) {
    const value = body[key];
    if (value === undefined || value === null || value === "") {
      if (required) throw new Error(`${LABELS[key]} is required.`);
      continue;
    }
    try {
      times[key] = parseEasternDateTimeLocal(value);
    } catch (error) {
      throw new Error(`${LABELS[key]}: ${error instanceof Error ? error.message : "Enter a valid date and time."}`);
    }
  }
  return times;
}

export function assertWindowOrder(opensAt: Date, closesAt: Date) {
  if (closesAt.getTime() <= opensAt.getTime()) throw new Error("Closes must be after Opens.");
}

/** "" or null clears the cap; otherwise a whole number of at least 1. */
export function parseMaxOrders(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Max orders must be a whole number of at least 1, or blank for no limit.");
  return parsed;
}

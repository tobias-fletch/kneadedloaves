import { z } from "zod";

export const productSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  description: z.string().min(10),
  priceCents: z.coerce.number().int().positive(),
  categoryId: z.string().optional().nullable(),
  allergens: z.array(z.string()).default([]),
  ingredients: z.array(z.string()).default([]),
  inventoryLimit: z.coerce.number().int().min(0),
  soldOut: z.boolean().default(false),
  active: z.boolean().default(true),
  imageUrl: z.string().refine((value) => !value || value.startsWith("/") || z.string().url().safeParse(value).success, {
    message: "Image must be a URL or uploaded file path."
  }).optional().or(z.literal(""))
});

export const orderSchema = z.object({
  customerEmail: z.string().trim().email().max(254),
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().max(40).optional(),
  fulfillmentType: z.enum(["DELIVERY", "PICKUP"]),
  deliveryZoneId: z.string().optional(),
  pickupLocationId: z.string().optional(),
  deliveryAddress: z.string().max(500).optional(),
  deliveryZip: z.string().optional()
}).superRefine((value, ctx) => {
  if (value.fulfillmentType === "DELIVERY" && (!value.deliveryAddress?.trim() || !/^\d{5}$/.test(value.deliveryZip || ""))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a delivery address and five-digit ZIP code." });
  }
});

export const cartMutationSchema = z.object({
  productId: z.string().min(1).max(100),
  quantity: z.number().finite().int().min(0).max(1000)
});


export function csvToArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

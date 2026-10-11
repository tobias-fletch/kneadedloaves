import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const resetInventorySchema = z.object({
  inventory: z.array(
    z.object({
      id: z.string(),
      inventoryLimit: z.coerce.number().int().min(0)
    })
  )
});

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = resetInventorySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid inventory reset." }, { status: 400 });

  await prisma.$transaction(
    parsed.data.inventory.map((item) =>
      prisma.product.update({
        where: { id: item.id },
        data: { inventoryLimit: item.inventoryLimit, soldOut: item.inventoryLimit <= 0 }
      })
    )
  );

  return NextResponse.json({ ok: true });
}

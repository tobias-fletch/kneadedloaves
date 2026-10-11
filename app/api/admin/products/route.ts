import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAutomatedDraft } from "@/lib/social";
import { productSchema } from "@/lib/validation";

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = productSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid product." }, { status: 400 });
  const { imageUrl, ...data } = parsed.data;
  const product = await prisma.product.create({
    data: {
      ...data,
      categoryId: data.categoryId || undefined,
      images: imageUrl ? { create: { url: imageUrl, alt: data.name } } : undefined
    }
  });
  await createAutomatedDraft({ title: product.name, trigger: "New product", productId: product.id });
  return NextResponse.json(product);
}

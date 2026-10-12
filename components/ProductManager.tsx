"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoney } from "@/lib/money";

type CategoryOption = {
  id: string;
  name: string;
};

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceCents: number;
  categoryId: string | null;
  categoryName: string | null;
  ingredients: string[];
  allergens: string[];
  inventoryLimit: number;
  soldOut: boolean;
  active: boolean;
  imageId: string | null;
  imageUrl: string | null;
};

export function ProductManager({
  products,
  categories
}: {
  products: ProductRow[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editArt, setEditArt] = useState("");

  const menuArt = [
    { value: "", label: "Keep current / choose pixel art" },
    { value: "/menu-art/focaccia.jpg", label: "🍞 Focaccia" },
    { value: "/menu-art/herb-focaccia.jpg", label: "🌿 Herb Focaccia" },
    { value: "/menu-art/artisan-bread.jpg", label: "🥖 Artisan Bread" },
    { value: "/menu-art/bagels.jpg", label: "🥯 Bagels" },
    { value: "/menu-art/cookies.jpg", label: "🍪 Cookies" },
  ];

  async function uploadImage(file: File) {
    if (!file.size) return "";
    const imageData = new FormData();
    imageData.append("file", file);
    const response = await fetch("/api/admin/uploads", { method: "POST", body: imageData });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Image upload failed.");
    return body.url as string;
  }

  async function save(productId: string, formData: FormData) {
    setMessage("");
    let uploadedUrl = "";
    try {
      const file = formData.get("imageFile");
      if (file instanceof File) uploadedUrl = await uploadImage(file);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image upload failed.");
      return;
    }

    const payload = {
      name: formData.get("name"),
      slug: formData.get("slug"),
      description: formData.get("description"),
      priceCents: Math.round(Number(formData.get("priceDollars") ?? 0) * 100),
      categoryId: formData.get("categoryId") || null,
      ingredients: String(formData.get("ingredients") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      allergens: String(formData.get("allergens") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      inventoryLimit: Number(formData.get("inventoryLimit") ?? 0),
      soldOut: formData.get("soldOut") === "on",
      active: formData.get("active") === "on",
      imageId: formData.get("imageId") || null,
      imageUrl: uploadedUrl || editArt || formData.get("imageUrl")
    };
    const response = await fetch(`/api/admin/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (response.ok) {
      setEditingId(null);
      setMessage("Product updated in the database.");
      router.refresh();
    } else {
      setMessage(body.error ?? "Could not update product.");
    }
  }

  async function remove(productId: string) {
    setMessage("");
    const response = await fetch(`/api/admin/products/${productId}`, { method: "DELETE" });
    const body = await response.json();
    if (response.ok) {
      setMessage("Product deleted from the database.");
      router.refresh();
    } else {
      setMessage(body.error ?? "Could not delete product. Mark it inactive if it has order history.");
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-amber-200 p-4">
        <h2 className="text-lg font-black">Products</h2>
        {message ? <p className="mt-2 text-sm font-semibold text-sage">{message}</p> : null}
      </div>
      <div className="divide-y divide-amber-100">
        {products.map((product) =>
          editingId === product.id ? (
            <form action={(formData) => save(product.id, formData)} className="space-y-3 p-4" key={product.id}>
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="name" defaultValue={product.name} required />
                <input name="slug" defaultValue={product.slug} required />
              </div>
              <textarea name="description" defaultValue={product.description} rows={3} required />
              <div className="grid gap-3 sm:grid-cols-3">
                <input name="priceDollars" defaultValue={(product.priceCents / 100).toFixed(2)} type="number" step="0.01" min="0" required />
                <input name="inventoryLimit" defaultValue={product.inventoryLimit} type="number" required />
                <select name="categoryId" defaultValue={product.categoryId ?? ""}>
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <input name="ingredients" defaultValue={product.ingredients.join(", ")} />
              <input name="allergens" defaultValue={product.allergens.join(", ")} />
              <input name="imageId" type="hidden" defaultValue={product.imageId ?? ""} />
              <select value={editArt} onChange={(e) => setEditArt(e.target.value)}>
                {menuArt.map((art) => (
                  <option key={art.value} value={art.value}>
                    {art.label}
                  </option>
                ))}
              </select>
              <input name="imageUrl" defaultValue={product.imageUrl ?? ""} placeholder="Or paste image URL" />
              <input name="imageFile" accept="image/jpeg,image/png,image/webp,image/gif" type="file" />
              <div className="flex flex-wrap gap-3 text-sm font-semibold">
                <label className="flex items-center gap-2">
                  <input className="h-4 w-4" name="active" type="checkbox" defaultChecked={product.active} />
                  Active
                </label>
                <label className="flex items-center gap-2">
                  <input className="h-4 w-4" name="soldOut" type="checkbox" defaultChecked={product.soldOut} />
                  Sold out
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary">Save changes</button>
                <button className="btn-secondary" type="button" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center" key={product.id}>
              <div>
                <p className="font-black">{product.name}</p>
                <p className="text-sm text-ink/60">
                  {product.categoryName ?? "No category"} | {product.inventoryLimit} available | {formatMoney(product.priceCents)}
                </p>
                <p className="mt-1 text-sm text-ink/70">{product.description}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={`badge ${product.active ? "bg-sage text-white" : "bg-crumb text-ink"}`}>
                    {product.active ? "Active" : "Inactive"}
                  </span>
                  <span className={`badge ${product.soldOut ? "bg-jam text-ink" : "bg-crumb text-ink"}`}>
                    {product.soldOut ? "Sold out" : "Available"}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 sm:flex-col">
                <button className="btn-secondary" type="button" onClick={() => { setEditingId(product.id); setEditArt(""); }}>
                  Edit
                </button>
                <button className="btn-secondary text-jam" type="button" onClick={() => remove(product.id)}>
                  Delete
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}

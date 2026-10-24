"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProductForm({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [selectedArt, setSelectedArt] = useState("");

  const menuArt = [
    { value: "", label: "Choose pixel art (or enter URL below)" },
    { value: "/menu-art/focaccia.jpg", label: "🍞 Focaccia" },
    { value: "/menu-art/herb-focaccia.jpg", label: "🌿 Herb Focaccia" },
    { value: "/menu-art/artisan-bread.jpg", label: "🥖 Artisan Bread" },
    { value: "/menu-art/bagels.jpg", label: "🥯 Bagels" },
    { value: "/menu-art/cookies.jpg", label: "🍪 Cookies" },
  ];

  async function submit(formData: FormData) {
    setMessage("");

    const priceDollars = Number(formData.get("priceDollars") ?? 0);
    const payload = {
      name: formData.get("name"),
      slug: formData.get("slug"),
      description: formData.get("description"),
      priceCents: Math.round(priceDollars * 100),
      categoryId: formData.get("categoryId") || null,
      allergens: String(formData.get("allergens") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      ingredients: String(formData.get("ingredients") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      inventoryLimit: Number(formData.get("inventoryLimit") ?? 0),
      soldOut: formData.get("soldOut") === "on",
      active: true,
      imageUrl: selectedArt || formData.get("imageUrl")
    };
    const response = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (response.ok) {
      router.refresh();
      setMessage("Product saved.");
    } else {
      setMessage(body.error ?? "Could not save product.");
    }
  }

  return (
    <form action={submit} className="panel space-y-3 p-4">
      <h2 className="text-lg font-black">Add product</h2>
      <input name="name" placeholder="Product name" required />
      <input name="slug" placeholder="product-slug" required />
      <textarea name="description" placeholder="Description" required rows={3} />
      <div className="grid grid-cols-2 gap-3">
        <input name="priceDollars" placeholder="Price ($)" required type="number" step="0.01" min="0" />
        <input name="inventoryLimit" placeholder="Inventory" required type="number" />
      </div>
      <select name="categoryId">
        <option value="">No category</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <input name="ingredients" placeholder="Ingredients, comma-separated" />
      <input name="allergens" placeholder="Allergens, comma-separated" />
      <select value={selectedArt} onChange={(e) => setSelectedArt(e.target.value)}>
        {menuArt.map((art) => (
          <option key={art.value} value={art.value}>
            {art.label}
          </option>
        ))}
      </select>
      {selectedArt && (
        <div className="flex items-center gap-3">
          <img src={selectedArt} alt="Preview" className="h-16 w-16 rounded border-2 border-ink object-cover" />
          <span className="text-sm font-semibold">Preview</span>
        </div>
      )}
      <input name="imageUrl" placeholder="Or paste image URL" type="url" />
      <label className="flex items-center gap-2">
        <input className="h-4 w-4" name="soldOut" type="checkbox" />
        Mark sold out
      </label>
      <button className="btn-primary w-full">Save product</button>
      {message ? <p className="text-sm font-semibold text-sage">{message}</p> : null}
    </form>
  );
}

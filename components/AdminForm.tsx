"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProductForm({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function uploadImage(file: File) {
    if (!file.size) return "";
    const imageData = new FormData();
    imageData.append("file", file);
    const response = await fetch("/api/admin/uploads", { method: "POST", body: imageData });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Image upload failed.");
    return body.url as string;
  }

  async function submit(formData: FormData) {
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
      priceCents: Number(formData.get("priceCents")),
      categoryId: formData.get("categoryId") || null,
      allergens: String(formData.get("allergens") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      ingredients: String(formData.get("ingredients") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      inventoryLimit: Number(formData.get("inventoryLimit") ?? 0),
      soldOut: formData.get("soldOut") === "on",
      active: true,
      imageUrl: uploadedUrl || formData.get("imageUrl")
    };
    const response = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (response.ok) {
      router.refresh();
      setMessage("Product saved and draft social post created.");
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
        <input name="priceCents" placeholder="Price cents" required type="number" />
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
      <input name="imageUrl" placeholder="Image URL" type="url" />
      <input name="imageFile" accept="image/jpeg,image/png,image/webp,image/gif" type="file" />
      <label className="flex items-center gap-2">
        <input className="h-4 w-4" name="soldOut" type="checkbox" />
        Mark sold out
      </label>
      <button className="btn-primary w-full">Save product</button>
      {message ? <p className="text-sm font-semibold text-sage">{message}</p> : null}
    </form>
  );
}

export function SocialPostForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function submit(formData: FormData) {
    const payload = {
      title: formData.get("title"),
      caption: formData.get("caption"),
      hashtags: String(formData.get("hashtags") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      platforms: formData.getAll("platforms"),
      status: formData.get("status"),
      scheduledAt: formData.get("scheduledAt") || null
    };
    const response = await fetch("/api/admin/social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    router.refresh();
    setMessage(response.ok ? "Post saved." : body.error ?? "Could not save.");
  }

  return (
    <form action={submit} className="panel space-y-3 p-4">
      <h2 className="text-lg font-black">Build post</h2>
      <input name="title" placeholder="Post title" required />
      <textarea name="caption" placeholder="Caption" rows={4} required />
      <input name="hashtags" placeholder="#bread, #microbakery" />
      <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
        {["INSTAGRAM", "TIKTOK", "FACEBOOK", "YOUTUBE_SHORTS"].map((platform) => (
          <label className="flex items-center gap-2 rounded-md border border-amber-200 p-2" key={platform}>
            <input className="h-4 w-4" type="checkbox" name="platforms" value={platform} defaultChecked={platform === "INSTAGRAM"} />
            {platform.replace("_", " ")}
          </label>
        ))}
      </div>
      <select name="status" defaultValue="DRAFT">
        {["DRAFT", "NEEDS_REVIEW", "APPROVED", "SCHEDULED", "REJECTED"].map((status) => (
          <option key={status}>{status}</option>
        ))}
      </select>
      <input name="scheduledAt" type="datetime-local" />
      <button className="btn-primary w-full">Save draft</button>
      {message ? <p className="text-sm font-semibold text-sage">{message}</p> : null}
    </form>
  );
}

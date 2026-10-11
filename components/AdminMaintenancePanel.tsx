"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProductResetRow = {
  id: string;
  name: string;
  inventoryLimit: number;
};

export function AdminMaintenancePanel({ products }: { products: ProductResetRow[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function resetOrders() {
    if (!window.confirm("Reset all orders, restore sold inventory, and empty carts?")) return;
    setMessage("");
    const response = await fetch("/api/admin/maintenance/reset-orders", { method: "POST" });
    const body = await response.json();
    setMessage(response.ok ? `Deleted ${body.deletedOrders} orders and restored sold inventory.` : body.error ?? "Could not reset orders.");
    if (response.ok) router.refresh();
  }

  async function resetInventory(formData: FormData) {
    setMessage("");
    const inventory = products.map((product) => ({
      id: product.id,
      inventoryLimit: Number(formData.get(`inventory-${product.id}`) ?? product.inventoryLimit)
    }));
    const response = await fetch("/api/admin/maintenance/reset-inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventory })
    });
    const body = await response.json();
    setMessage(response.ok ? "Inventory reset." : body.error ?? "Could not reset inventory.");
    if (response.ok) router.refresh();
  }

  return (
    <section className="panel space-y-4 p-4">
      <div>
        <h2 className="text-lg font-black">Maintenance</h2>
        <p className="mt-1 text-sm text-ink/70">Use these tools to reset local testing data before a clean checkout run.</p>
      </div>
      <button className="btn-secondary text-jam" type="button" onClick={resetOrders}>
        Reset orders and restore inventory
      </button>
      <form action={resetInventory} className="space-y-3">
        <h3 className="font-black">Reset inventory counts</h3>
        {products.map((product) => (
          <label className="grid gap-1" key={product.id}>
            <span>{product.name}</span>
            <input name={`inventory-${product.id}`} type="number" min="0" defaultValue={product.inventoryLimit} />
          </label>
        ))}
        <button className="btn-primary">Save inventory reset</button>
      </form>
      {message ? <p className="rounded-md bg-crumb p-3 text-sm font-semibold text-ink">{message}</p> : null}
    </section>
  );
}

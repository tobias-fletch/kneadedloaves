/** Brand colour per order status so the admin can scan a list at a glance. */
export function orderStatusTone(status: string) {
  switch (status) {
    case "PENDING": return "bg-butter";
    case "CANCELLED": return "bg-page text-ink/60";
    case "COMPLETED": return "bg-sage text-page";
    default: return "bg-crumb";
  }
}

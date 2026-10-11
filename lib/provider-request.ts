import type { Order, OrderItem } from "@prisma/client";
import type Stripe from "stripe";
export function providerRequestSnapshot(order: Order & { items: OrderItem[] }, token: string, appUrl: string) {
  const receiptPath = `/orders/${order.id}?receipt=${token}`;
  const receiptUrl = `${new URL(appUrl).origin}${receiptPath}`;
  if (order.paymentProvider === "STRIPE") {
    const stripe: Stripe.Checkout.SessionCreateParams = {
      mode: "payment", payment_method_types: ["card"], customer_email: order.customerEmail,
      success_url: receiptUrl, cancel_url: `${receiptUrl}&cancelled=1`,
      client_reference_id: order.id, metadata: { orderId: order.id }, payment_intent_data: { metadata: { orderId: order.id } },
      expires_at: Math.floor(order.reservationExpiresAt!.getTime() / 1000),
      line_items: [...order.items.map(item => ({ quantity: item.quantity, price_data: { currency: "usd", unit_amount: item.unitPriceCents, product_data: { name: item.productName } } })),
        ...(order.deliveryFeeCents ? [{ quantity: 1, price_data: { currency: "usd", unit_amount: order.deliveryFeeCents, product_data: { name: "Delivery fee" } } }] : []),
        ...(order.taxCents ? [{ quantity: 1, price_data: { currency: "usd", unit_amount: order.taxCents, product_data: { name: "Sales tax" } } }] : [])]
    };
    return { receiptPath, stripe };
  }
  return { receiptPath, paypal: {
    intent: "CAPTURE", purchase_units: [{ reference_id: order.id, custom_id: order.id, invoice_id: order.id, amount: { currency_code: "USD", value: (order.totalCents / 100).toFixed(2) } }],
    payment_source: { paypal: { experience_context: { user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: `${receiptUrl}&paypal=approved`, cancel_url: `${receiptUrl}&cancelled=1` } } }
  } };
}

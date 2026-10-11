import { getCheckoutReadiness } from "@/lib/checkout-readiness";
import { getAppConfigValue, getAppConfigValues } from "@/lib/app-config";
import { prisma } from "@/lib/prisma";

type SetupItem = {
  id: string;
  title: string;
  detail: string;
  href?: string;
  complete: boolean;
  group: "Storefront" | "Payments" | "Fulfillment" | "Notifications" | "Social" | "Launch";
};

function isLocalUrl(value?: string) {
  return !value || value.includes("localhost") || value.includes("127.0.0.1");
}

export async function getSetupChecklist() {
  const [
    settings,
    activeProducts,
    realProducts,
    productImages,
    activeWindows,
    futureWindows,
    deliveryZones,
    pickupLocations,
    socialAccounts,
    subscribers
  ] = await Promise.all([
    prisma.adminSettings.findFirst(),
    prisma.product.count({ where: { active: true } }),
    prisma.product.count({
      where: {
        active: true,
        slug: { notIn: ["country-sourdough", "cardamom-morning-buns", "seeded-rye-tin"] }
      }
    }),
    prisma.productImage.count(),
    prisma.orderWindow.count({
      where: {
        manualClosed: false,
        closesAt: { gte: new Date() }
      }
    }),
    prisma.orderWindow.count({
      where: {
        opensAt: { gt: new Date() }
      }
    }),
    prisma.deliveryZone.count({ where: { active: true } }),
    prisma.pickupLocation.count({ where: { active: true } }),
    prisma.socialPlatformAccount.count({ where: { connected: true } }),
    prisma.emailSubscriber.count({ where: { active: true } })
  ]);

  const config = await getAppConfigValues([
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "EMAIL_FROM",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "EMAIL_PICKUP_SUBJECT",
    "EMAIL_PICKUP_BODY",
    "EMAIL_DELIVERY_SUBJECT",
    "EMAIL_DELIVERY_BODY",
    "APP_URL",
    "CHECKOUT_SMOKE_TESTED",
    "STRIPE_TEST_MODE",
    "INSTAGRAM_GRAPH_TOKEN",
    "FACEBOOK_PAGE_TOKEN",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET"
  ]);
  const paymentReady = await getCheckoutReadiness();
  const stripeReady = Boolean(config.STRIPE_SECRET_KEY);
  
  const emailReady = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"].every((key) => Boolean(config[key as keyof typeof config]));
  const emailTemplatesReady = ["EMAIL_PICKUP_SUBJECT", "EMAIL_PICKUP_BODY", "EMAIL_DELIVERY_SUBJECT", "EMAIL_DELIVERY_BODY"].every((key) =>
    Boolean(config[key as keyof typeof config])
  );
  const appUrl = config.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const socialCredentialGroups = [
    ["INSTAGRAM_GRAPH_TOKEN"],
    ["FACEBOOK_PAGE_TOKEN"],
    ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]
  ];
  const connectedSocialApis = socialCredentialGroups.filter((group) => group.every((key) => Boolean(config[key as keyof typeof config]))).length;
  const jwtSecret = await getAppConfigValue("JWT_SECRET");

  const items: SetupItem[] = [
    { id: "live-checkout", group: "Payments", title: "Verify and enable live checkout", detail: "Confirm menu, allergens, service ZIPs, fees, capacity, cutoff times and applicable tax handling. Verify a live-ready provider and its webhooks before enabling checkout.", href: "/admin/setup", complete: paymentReady.providers.length > 0 },
    { id: "paypal", group: "Payments", title: "Connect PayPal when required", detail: "Set the server-side client credentials and webhook ID, verify sandbox and live events, then enable PayPal.", href: "/admin/setup", complete: paymentReady.providers.includes("PAYPAL") },
    {
      id: "real-products",
      group: "Storefront",
      title: "Replace seed products with your real menu",
      detail: "Add at least one active product that is not part of the sample seed menu.",
      href: "/admin/products",
      complete: realProducts > 0
    },
    {
      id: "product-images",
      group: "Storefront",
      title: "Add product photos",
      detail: "Customers should see product images before checkout.",
      href: "/admin/products",
      complete: activeProducts > 0 && productImages >= activeProducts
    },
    {
      id: "order-window",
      group: "Storefront",
      title: "Schedule an ordering window",
      detail: "Create at least one open or upcoming order window with a fulfillment date.",
      href: "/admin/windows",
      complete: activeWindows > 0 || futureWindows > 0
    },
    {
      id: "stripe-secret",
      group: "Payments",
      title: "Add Stripe secret key",
      detail: "Add STRIPE_SECRET_KEY in the Setup tab so checkout redirects customers to Stripe.",
      href: "/admin/setup",
      complete: stripeReady
    },
    {
      id: "stripe-webhook",
      group: "Payments",
      title: "Add Stripe webhook secret",
      detail: "Configure and verify Stripe completion, expiry, refund and dispute webhooks. Checkout also requires launch, tax and smoke-test settings.",
      href: "/admin/setup",
      complete: paymentReady.providers.includes("STRIPE")
    },
    {
      id: "public-url",
      group: "Payments",
      title: "Set the public app URL",
      detail: "Add your deployed shop URL in the Setup tab so Stripe success and cancel redirects work outside localhost.",
      href: "/admin/setup",
      complete: !isLocalUrl(appUrl)
    },
    {
      id: "checkout-smoke-test",
      group: "Payments",
      title: "Smoke-test cart and checkout",
      detail: "Add an item, adjust the cart, place a test order, and confirm the order appears in admin.",
      href: "/admin/setup",
      complete: config.CHECKOUT_SMOKE_TESTED === "true"
    },
    {
      id: "fulfillment-method",
      group: "Fulfillment",
      title: "Confirm pickup or delivery options",
      detail: "Create at least one active pickup location or delivery zone.",
      href: "/admin/windows",
      complete: pickupLocations > 0 || deliveryZones > 0
    },
    {
      id: "delivery-zones",
      group: "Fulfillment",
      title: "Add delivery zones if you deliver",
      detail: "Define ZIP codes and fees for local delivery, or keep pickup-only intentionally.",
      complete: deliveryZones > 0
    },
    {
      id: "email-provider",
      group: "Notifications",
      title: "Connect email notifications",
      detail: "Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and EMAIL_FROM in the Setup tab.",
      href: "/admin/setup",
      complete: emailReady
    },
    {
      id: "notification-settings",
      group: "Notifications",
      title: "Choose notification settings",
      detail: "Set a notification email and decide whether admin email notifications should be enabled.",
      complete: Boolean(settings?.notificationEmail)
    },
    {
      id: "email-templates",
      group: "Notifications",
      title: "Review customer email templates",
      detail: "Customize pickup and delivery confirmation emails before launch.",
      href: "/admin/email",
      complete: emailTemplatesReady
    },
    {
      id: "social-handles",
      group: "Social",
      title: "Add social media handles",
      detail: "Add Instagram, TikTok, Facebook, or YouTube handles in admin settings.",
      complete: Boolean(settings?.instagramHandle || settings?.tiktokHandle || settings?.facebookHandle || settings?.youtubeHandle)
    },
    {
      id: "social-api-keys",
      group: "Social",
      title: "Connect social API credentials",
      detail: "Add credentials for Instagram, Facebook, TikTok, and YouTube if you want approved posts to publish through APIs.",
      href: "/admin/setup",
      complete: connectedSocialApis === socialCredentialGroups.length || socialAccounts > 0
    },
    {
      id: "email-list",
      group: "Launch",
      title: "Import or collect email subscribers",
      detail: "Add subscribers before sending menu announcements or launch newsletters.",
      complete: subscribers > 0
    },
    {
      id: "jwt-secret",
      group: "Launch",
      title: "Set a production session secret",
      detail: "Add a long JWT_SECRET in the Setup tab before deploying.",
      href: "/admin/setup",
      complete: jwtSecret.length >= 32 && !/development|replace-with|change-me/i.test(jwtSecret)
    }
  ];

  const incomplete = items.filter((item) => !item.complete);
  return {
    completeCount: items.length - incomplete.length,
    totalCount: items.length,
    incomplete
  };
}

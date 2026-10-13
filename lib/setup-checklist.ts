import { getAppConfigValues } from "@/lib/app-config";
import { getManualPaymentConfig } from "@/lib/manual-payment-config";
import { prisma } from "@/lib/prisma";

type SetupItem = {
  id: string;
  title: string;
  detail: string;
  href?: string;
  complete: boolean;
  group: "Storefront" | "Payments" | "Fulfillment" | "Notifications" | "Social" | "Launch";
};

function isPublicShopUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
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
    "EMAIL_FROM",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "APP_URL",
    "CHECKOUT_SMOKE_TESTED",
    "INSTAGRAM_GRAPH_TOKEN",
    "FACEBOOK_PAGE_TOKEN",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET"
  ]);
  const payment = await getManualPaymentConfig();
  const emailReady = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"].every((key) => Boolean(config[key as keyof typeof config])) && [465, 587, 2525].includes(Number(config.SMTP_PORT));
  const appUrl = config.APP_URL;
  const socialCredentialGroups = [
    ["INSTAGRAM_GRAPH_TOKEN"],
    ["FACEBOOK_PAGE_TOKEN"],
    ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]
  ];
  const connectedSocialApis = socialCredentialGroups.filter((group) => group.every((key) => Boolean(config[key as keyof typeof config]))).length;
  const jwtSecret = payment.JWT_SECRET;

  const items: SetupItem[] = [
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
      id: "manual-venmo-readiness",
      group: "Payments",
      title: "Complete manual Venmo checkout readiness",
      detail: payment.ready
        ? "All required configuration checks pass. Independently verify each completed payment in the bakery's Venmo business account before fulfillment."
        : payment.reasons.join(" "),
      href: "/admin/setup",
      complete: payment.ready
    },
    {
      id: "public-url",
      group: "Payments",
      title: "Set the public app URL",
      detail: "Set the canonical HTTPS shop URL for private receipts and customer links. Local development URLs are not launch-ready.",
      href: "/admin/setup",
      complete: isPublicShopUrl(appUrl)
    },
    {
      id: "checkout-smoke-test",
      group: "Payments",
      title: "Smoke-test cart and checkout",
      detail: "Test guest checkout and reload recovery, independent exact-payment verification, mismatches, expiry, refunds, and queued email delivery before confirming this check in Setup.",
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
      detail: "Configure authenticated TLS email in Setup. Saved credentials alone do not prove that queued messages were delivered.",
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
      id: "lifecycle-email-test",
      group: "Notifications",
      title: "Test manual-payment lifecycle emails",
      detail: "Test queued reservation, payment-verified, and expiry messages with the deployed email worker. Legacy pickup and delivery templates are not used by manual Venmo checkout.",
      href: "/admin/email",
      complete: emailReady && payment.PAYMENT_WORKERS_READY === "true"
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

import { prisma } from "@/lib/prisma";

export type ContactDetails = {
  bakeryName: string;
  email: string;
  phone: string;
  phoneHref: string;
  instagramHandle: string;
};

function phoneHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

export async function getContactDetails(): Promise<ContactDetails> {
  const settings = await prisma.adminSettings.findFirst().catch(() => null);
  const email =
    process.env.CONTACT_EMAIL?.trim() ||
    settings?.notificationEmail?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    "orders@example.com";
  const phone = process.env.CONTACT_PHONE?.trim() || "";

  return {
    bakeryName: settings?.bakeryName ?? "Kneaded Loaves",
    email,
    phone,
    phoneHref: phoneHref(phone),
    instagramHandle: settings?.instagramHandle ?? ""
  };
}

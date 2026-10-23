import { BAKERY_CONTACT_EMAIL } from "@/lib/config-messages";
import { prisma } from "@/lib/prisma";

export type ContactDetails = {
  bakeryName: string;
  email: string;
  phone: string;
  phoneHref: string;
  instagramHandle: string;
};

export function publicContactEmail(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const wrapped = trimmed.match(/<([^<>\s]+@[^<>\s]+)>/);
  const email = (wrapped ? wrapped[1] : trimmed).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "example.com" || domain.endsWith(".example.com") || domain.endsWith(".example") || domain === "example.test" || domain === "example.invalid" || domain === "bakery.local") return "";
  return email;
}

export function resolvePublicContactEmail(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const email = publicContactEmail(candidate);
    if (email) return email;
  }
  return BAKERY_CONTACT_EMAIL;
}

export async function getContactDetails(): Promise<ContactDetails> {
  const settings = await prisma.adminSettings.findFirst().catch(() => null);
  return {
    bakeryName: settings?.bakeryName ?? "Kneaded Loaves",
    email: resolvePublicContactEmail(process.env.CONTACT_EMAIL, settings?.notificationEmail, process.env.EMAIL_FROM),
    phone: "",
    phoneHref: "",
    instagramHandle: settings?.instagramHandle ?? ""
  };
}

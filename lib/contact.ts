import { BAKERY_CONTACT_EMAIL, BAKERY_INSTAGRAM_HANDLE } from "@/lib/config-messages";
import { prisma } from "@/lib/prisma";

const INSTAGRAM_PROFILE_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/@?([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i;
const INSTAGRAM_HANDLE = /^[A-Za-z0-9._]{1,30}$/;

/** Bare Instagram username. Empty admin values use the bakery account. @ and profile URLs are stripped so links stay on instagram.com. */
export function normalizeInstagramHandle(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return BAKERY_INSTAGRAM_HANDLE;

  const fromProfileUrl = trimmed.match(INSTAGRAM_PROFILE_URL);
  const handle = (fromProfileUrl ? fromProfileUrl[1] : trimmed.replace(/^@+/, "")).trim();
  if (fromProfileUrl) return INSTAGRAM_HANDLE.test(handle) ? handle : BAKERY_INSTAGRAM_HANDLE;
  if (/[/:]/.test(trimmed) || /\s/.test(handle) || !INSTAGRAM_HANDLE.test(handle)) return BAKERY_INSTAGRAM_HANDLE;
  return handle;
}

export function instagramProfileUrl(handle: string) {
  return `https://www.instagram.com/${normalizeInstagramHandle(handle)}/`;
}

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
    email: resolvePublicContactEmail(process.env.CONTACT_EMAIL, settings?.notificationEmail),
    phone: "",
    phoneHref: "",
    instagramHandle: normalizeInstagramHandle(settings?.instagramHandle)
  };
}

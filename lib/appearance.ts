import type { CSSProperties } from "react";
import { prisma } from "@/lib/prisma";

export const appearanceKeys = [
  "APPEARANCE_COLOR_CRUST",
  "APPEARANCE_COLOR_CRUMB",
  "APPEARANCE_COLOR_BUTTER",
  "APPEARANCE_COLOR_JAM",
  "APPEARANCE_COLOR_SAGE",
  "APPEARANCE_COLOR_INK",
  "APPEARANCE_COLOR_PAGE",
  "APPEARANCE_FONT_BODY",
  "APPEARANCE_FONT_HEADING"
] as const;

export type AppearanceKey = (typeof appearanceKeys)[number];

export type SiteAppearance = {
  colorCrust: string;
  colorCrumb: string;
  colorButter: string;
  colorJam: string;
  colorSage: string;
  colorInk: string;
  colorPage: string;
  fontBody: string;
  fontHeading: string;
};

export const defaultAppearance: SiteAppearance = {
  colorCrust: "#8B4A2B",
  colorCrumb: "#F8E7D2",
  colorButter: "#F6C85F",
  colorJam: "#9F2B45",
  colorSage: "#63755B",
  colorInk: "#2D211B",
  colorPage: "#FFFAF3",
  fontBody: "system-ui, sans-serif",
  fontHeading: "system-ui, sans-serif"
};

const fieldByKey: Record<AppearanceKey, keyof SiteAppearance> = {
  APPEARANCE_COLOR_CRUST: "colorCrust",
  APPEARANCE_COLOR_CRUMB: "colorCrumb",
  APPEARANCE_COLOR_BUTTER: "colorButter",
  APPEARANCE_COLOR_JAM: "colorJam",
  APPEARANCE_COLOR_SAGE: "colorSage",
  APPEARANCE_COLOR_INK: "colorInk",
  APPEARANCE_COLOR_PAGE: "colorPage",
  APPEARANCE_FONT_BODY: "fontBody",
  APPEARANCE_FONT_HEADING: "fontHeading"
};

export const keyByField = Object.fromEntries(
  Object.entries(fieldByKey).map(([key, field]) => [field, key])
) as Record<keyof SiteAppearance, AppearanceKey>;

export async function getAppearance(): Promise<SiteAppearance> {
  const rows = await prisma.appConfig.findMany({ where: { key: { in: [...appearanceKeys] } } }).catch(() => []);
  const appearance = { ...defaultAppearance };

  for (const row of rows) {
    const field = fieldByKey[row.key as AppearanceKey];
    if (field && row.value.trim()) {
      appearance[field] = row.value.trim();
    }
  }

  return appearance;
}

function hexToRgbParts(hex: string) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "";
  if (!normalized) return "0 0 0";
  const value = Number.parseInt(normalized, 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

export function appearanceToCssVars(appearance: SiteAppearance) {
  return {
    "--color-crust-rgb": hexToRgbParts(appearance.colorCrust),
    "--color-crumb-rgb": hexToRgbParts(appearance.colorCrumb),
    "--color-butter-rgb": hexToRgbParts(appearance.colorButter),
    "--color-jam-rgb": hexToRgbParts(appearance.colorJam),
    "--color-sage-rgb": hexToRgbParts(appearance.colorSage),
    "--color-ink-rgb": hexToRgbParts(appearance.colorInk),
    "--color-page-rgb": hexToRgbParts(appearance.colorPage),
    "--font-body": appearance.fontBody,
    "--font-heading": appearance.fontHeading
  } as CSSProperties & Record<string, string>;
}

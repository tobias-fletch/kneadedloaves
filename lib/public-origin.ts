/** Build server redirects from the configured public origin, never a proxy's internal URL. */
export function publicRedirectUrl(request: Pick<Request, "url">, path: string) {
  const configured = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured && process.env.NODE_ENV === "production") throw new Error("A canonical public HTTPS URL is required.");
  const base = new URL(configured || new URL(request.url).origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash || (process.env.NODE_ENV === "production" && base.protocol !== "https:")) throw new Error("A canonical public HTTPS URL is required.");
  const destination = new URL(path, base.origin);
  if (!path.startsWith("/") || destination.origin !== base.origin) throw new Error("Redirects must stay on the shop origin.");
  return destination;
}

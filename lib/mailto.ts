export function buildMailtoUrl(input: {
  to: string;
  subject?: string;
  body?: string;
}) {
  const params = new URLSearchParams();
  if (input.subject) params.set("subject", input.subject);
  if (input.body) params.set("body", input.body);
  const query = params.toString();
  return `mailto:${input.to}${query ? `?${query}` : ""}`;
}

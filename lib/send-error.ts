/**
 * A safe, one-line summary of a failed Resend send, for logs.
 *
 * Site email goes through the Resend SMTP relay (smtp.resend.com) via nodemailer, so a failed
 * send carries nodemailer's error fields. Only three are kept: `code` (e.g. EAUTH for a bad or
 * revoked RESEND_API_KEY, ECONNECTION, ETIMEDOUT), `responseCode` (Resend's reply number, e.g.
 * 535 or 550) and `command` (the step that failed, e.g. "AUTH PLAIN", "RCPT TO"). The error
 * message and Resend's response text are never included, because they can echo the API key,
 * recipient addresses or message content. Each field is checked against a strict pattern, so
 * nothing else can leak through it.
 */
export function sendErrorSummary(error: unknown): string {
  const source = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const code = typeof source.code === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(source.code) ? source.code : "-";
  const responseCode =
    typeof source.responseCode === "number" && Number.isInteger(source.responseCode) && source.responseCode >= 100 && source.responseCode <= 599
      ? String(source.responseCode)
      : "-";
  const command = typeof source.command === "string" && /^[A-Z]{2,10}( [A-Z]{2,10})?$/.test(source.command) ? source.command : "-";
  return `code=${code} responseCode=${responseCode} command=${command}`;
}

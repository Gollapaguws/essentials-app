/**
 * Escape a value for insertion into HTML text or a double-quoted attribute.
 * Every server-rendered page (for example the invoice print view) interpolates
 * user- or promoter-controlled text, so all of it goes through here.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

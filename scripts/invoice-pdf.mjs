/**
 * Phase 3 hook: batch-render invoice PDFs with Puppeteer.
 * Optional — the API's /invoices/:id/print page is already print-to-PDF ready.
 * Usage: node scripts/invoice-pdf.mjs <invoiceId> [out.pdf]  (requires API token)
 */
import { chromium } from "puppeteer";

const [, , invoiceId, out = `invoice-${invoiceId}.pdf`] = process.argv;
const API_URL = process.env.API_URL ?? "http://localhost:4000";
const token = process.env.API_TOKEN;
if (!invoiceId || !token) {
  console.error("Usage: API_TOKEN=... node scripts/invoice-pdf.mjs <invoiceId> [out.pdf]");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${API_URL}/api/invoices/${invoiceId}/print`, {
  waitUntil: "networkidle0",
  headers: { Authorization: `Bearer ${token}` },
});
await page.pdf({ path: out, format: "A4", printBackground: true });
await browser.close();
console.log(`PDF written: ${out}`);

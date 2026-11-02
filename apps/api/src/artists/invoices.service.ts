import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma, InvoiceStatus, PaymentStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { randomBytes } from "crypto";

/**
 * Phase 3 invoices + payments.
 * - Invoice built from confirmed bookings: performance fee + billable travel legs.
 * - Branded print-ready HTML (print-to-PDF; Puppeteer render script in scripts/).
 * - Payments via PayFast/Stripe payment links (no SDK keys needed in Phase 3).
 */
@Injectable()
export class InvoicesService {
  constructor(private config: ConfigService) {}

  async list(user: JwtUser) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) return [];
    return prisma.invoice.findMany({
      where: { artistId: profile.id },
      include: { items: true, payments: true },
      orderBy: { id: "desc" },
    });
  }

  /** Generate an invoice from one or more confirmed bookings (defaults: all confirmed, uninvoiced). */
  async generate(user: JwtUser, bookingIds?: string[]) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Create your artist profile first");

    const bookings = await prisma.artistBooking.findMany({
      where: {
        artistId: profile.id,
        status: "confirmed",
        ...(bookingIds?.length ? { id: { in: bookingIds } } : {}),
      },
      include: { event: { include: { venue: true } }, routeLegs: true },
    });
    if (!bookings.length) throw new BadRequestException("No confirmed bookings to invoice");

    const number = `ESS-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const items = [
      ...bookings.map((b) => ({
        label: `${b.event.title} @ ${b.event.venue.name} — performance (${b.startAt.toISOString().slice(0, 10)})`,
        amount: b.performanceFee,
      })),
      ...bookings.flatMap((b) =>
        b.routeLegs.map((l) => ({
          label: `${b.event.title} — travel ${l.distanceKm} km (${l.isConflict ? "conflict flagged" : "ok"})`,
          amount: Math.round(l.distanceKm * profile.travelRatePerKm),
        })),
      ),
    ];
    const total = items.reduce((s, i) => s + i.amount, 0);

    return prisma.invoice.create({
      data: {
        artistId: profile.id,
        number,
        status: InvoiceStatus.sent,
        total,
        items: { create: items },
      },
      include: { items: true },
    });
  }

  /** Branded print-ready invoice (open and Ctrl+P → PDF, or render with scripts/invoice-pdf.mjs). */
  async renderHtml(user: JwtUser, invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true, artist: { include: { user: { select: { name: true, email: true } } } } },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (user.role !== "admin" && invoice.artist.user.email !== user.email) throw new ForbiddenException();

    const rows = invoice.items
      .map((i) => `<tr><td>${i.label}</td><td style="text-align:right">${i.amount.toLocaleString()}</td></tr>`)
      .join("");
    return `<html><head><title>${invoice.number}</title><style>
      body{font-family:Helvetica,Arial,sans-serif;color:#0A0A0A;padding:48px;max-width:640px;margin:auto}
      h1{letter-spacing:3px;color:#00B24A;margin:0}
      .bar{border-top:4px solid #00FF66;margin:12px 0 24px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left;font-size:14px}
      .total{font-size:18px;font-weight:bold}
    </style></head><body>
      <h1>ESSENTIALS</h1><div class="bar"></div>
      <p><strong>Invoice ${invoice.number}</strong><br/>
      Artist: ${invoice.artist.stageName} (${invoice.artist.user.email})<br/>
      Date: ${new Date().toISOString().slice(0, 10)} · Status: ${invoice.status}</p>
      <table><tr><th>Item</th><th style="text-align:right">Amount</th></tr>${rows}
      <tr><td class="total">Total</td><td class="total" style="text-align:right">${invoice.total.toLocaleString()}</td></tr></table>
      <p style="font-size:12px;color:#666;margin-top:32px">Payment: via the payment link sent by ESSENTIALS. Thank you for playing.</p>
    </body></html>`;
  }

  /** Create a payment link record (PayFast/Stripe hosted link). */
  async createPaymentLink(user: JwtUser, invoiceId: string, provider: "payfast" | "stripe") {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { artist: { include: { user: true } } },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (user.role !== "admin" && invoice.artist.user.email !== user.email) throw new ForbiddenException();

    const reference = `${invoice.number}-${randomBytes(4).toString("hex")}`;
    const appUrl = this.config.get("APP_URL") ?? "https://essentials.example";
    const url =
      provider === "stripe"
        ? `${appUrl}/pay/stripe/${reference}` // replace with Stripe Payment Links API once STRIPE_KEY set (Phase 4)
        : `${appUrl}/pay/payfast/${reference}`;
    const payment = await prisma.payment.create({
      data: { invoiceId, provider, reference, amount: invoice.total, status: PaymentStatus.pending },
    });
    return { paymentId: payment.id, provider, reference, url, amount: invoice.total };
  }
}

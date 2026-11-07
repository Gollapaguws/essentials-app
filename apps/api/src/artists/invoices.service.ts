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

  /**
   * Invoice the venue for a gig the promoter has confirmed as played.
   *
   * One completed booking per invoice, at the stipulated fee (the event's hourly
   * DJ rate × the slot's length). A booking can only ever be billed once — the
   * unique `bookingId` is what enforces that, not the UI.
   */
  async generate(user: JwtUser, bookingIds?: string[]) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Create your artist profile first");
    if (bookingIds && bookingIds.length > 1) {
      throw new BadRequestException("Invoice one completed gig at a time — each venue pays for its own night");
    }

    const bookings = await prisma.artistBooking.findMany({
      where: {
        artistId: profile.id,
        // Only a gig the promoter confirmed was played may be billed.
        status: "completed",
        invoice: { is: null },
        ...(bookingIds?.length ? { id: { in: bookingIds } } : {}),
      },
      include: { event: { include: { venue: true } } },
      orderBy: { startAt: "desc" },
      ...(bookingIds?.length ? {} : { take: 1 }),
    });
    if (!bookings.length) {
      throw new BadRequestException(
        "No completed, uninvoiced gigs — the promoter confirms a gig was played before you can invoice it",
      );
    }

    const booking = bookings[0];
    if (booking.performanceFee <= 0) {
      throw new BadRequestException("This gig has no agreed fee — the promoter sets the DJ fee per hour on the event");
    }

    const venueName = booking.event.venue.name;
    const hours = Math.max(0.25, (booking.endAt.getTime() - booking.startAt.getTime()) / 3_600_000);
    const number = `ESS-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const items = [
      {
        label: `${booking.event.title} @ ${venueName} — ${+hours.toFixed(2)}h performance (${booking.startAt.toISOString().slice(0, 10)})`,
        amount: booking.performanceFee,
      },
    ];
    const total = booking.performanceFee;

    return prisma.invoice.create({
      data: {
        artistId: profile.id,
        bookingId: booking.id,
        venueId: booking.event.venueId,
        number,
        status: InvoiceStatus.sent,
        total,
        items: { create: items },
      },
      include: { items: true, venue: { select: { name: true } }, booking: { select: { id: true } } },
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

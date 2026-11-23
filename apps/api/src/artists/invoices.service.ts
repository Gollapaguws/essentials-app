import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma, InvoiceStatus, PaymentStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { NotificationsService } from "../notifications/notifications.service";
import { randomBytes } from "crypto";
import { escapeHtml } from "../common/html";
import { homeTravel } from "../common/geo";

/** The fields a venue needs to pay the DJ directly. Account type is optional. */
const REQUIRED_BANK_FIELDS = [
  { label: "account holder", key: "bankAccountHolder" },
  { label: "bank name", key: "bankName" },
  { label: "account number", key: "bankAccountNumber" },
  { label: "branch code", key: "bankBranchCode" },
] as const;

type BankProfile = {
  bankAccountHolder: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankBranchCode: string | null;
  bankAccountType: string | null;
};

function missingBankFields(profile: BankProfile) {
  return REQUIRED_BANK_FIELDS.filter(({ key }) => !profile[key]?.trim()).map(({ label }) => label);
}

/** The payout block on the printable invoice. Empty for invoices created before this existed. */
function bankDetailsHtml(profile: BankProfile) {
  const rows = [
    ["Account holder", profile.bankAccountHolder],
    ["Bank", profile.bankName],
    ["Account number", profile.bankAccountNumber],
    ["Branch code", profile.bankBranchCode],
    ["Account type", profile.bankAccountType],
  ].filter(([, value]) => value?.trim());
  if (!rows.length) return "";

  return `<div class="bank"><h2>Payment details</h2>${rows
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value ?? "")}</p>`)
    .join("")}<p class="muted">Please quote the invoice number as your payment reference.</p></div>`;
}

/**
 * Phase 3 invoices + payments.
 * - Invoice built from confirmed bookings: performance fee + billable travel legs.
 * - Branded print-ready HTML (print-to-PDF; Puppeteer render script in scripts/).
 * - Payments via PayFast/Stripe payment links (no SDK keys needed in Phase 3).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {}

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
   * DJ rate × the slot's length) plus return travel from the DJ's home base to
   * the venue at the platform rate. A booking can only ever be billed once — the
   * unique `bookingId` is what enforces that, not the UI.
   */
  async generate(user: JwtUser, bookingIds?: string[]) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Create your artist profile first");
    const missing = missingBankFields(profile);
    if (missing.length) {
      throw new BadRequestException(
        `Add your bank account details in My Profile before invoicing (${missing.join(", ")} missing).`,
      );
    }
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
      include: {
        event: {
          include: { venue: { select: { name: true, address: true, lat: true, lng: true } } },
        },
      },
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
      throw new BadRequestException(
        "This gig is unpaid (the DJ fee per hour is R0), so there is nothing to invoice",
      );
    }

    if (!profile.homeAddress || profile.homeLat == null || profile.homeLng == null) {
      throw new BadRequestException(
        "Add your home base address in My Profile so travel to the venue can be calculated.",
      );
    }

    const venue = booking.event.venue;
    const travel = homeTravel(profile, venue);
    if (!travel) {
      throw new BadRequestException(
        "This venue has no map coordinates, so travel cannot be calculated. Ask the venue manager to set its location.",
      );
    }

    const venueName = venue.name;
    const hours = Math.max(0.25, (booking.endAt.getTime() - booking.startAt.getTime()) / 3_600_000);
    const number = `ESS-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const items = [
      {
        label: `${booking.event.title} @ ${venueName} — ${+hours.toFixed(2)}h performance (${booking.startAt.toISOString().slice(0, 10)})`,
        amount: booking.performanceFee,
      },
    ];
    if (travel.fee > 0) {
      items.push({
        label: `Travel: home base to ${venueName} and back — ${travel.distanceKm.toFixed(1)} km @ R${profile.travelRatePerKm.toFixed(2)}/km`,
        amount: travel.fee,
      });
    }
    const total = booking.performanceFee + travel.fee;

    const [invoice] = await prisma.$transaction([
      prisma.invoice.create({
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
      }),
      // Snapshot the amount on the booking too, so the promoter's DJ history and
      // the invoice always agree even after the rate changes.
      prisma.artistBooking.update({ where: { id: booking.id }, data: { travelFee: travel.fee } }),
    ]);

    return invoice;
  }

  /** Branded print-ready invoice (open and Ctrl+P → PDF, or render with scripts/invoice-pdf.mjs). */
  async renderHtml(user: JwtUser, invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        artist: { include: { user: { select: { name: true, email: true } } } },
        venue: { select: { name: true, address: true } },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (user.role !== "admin" && invoice.artist.user.email !== user.email) throw new ForbiddenException();

    const rows = invoice.items
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.label)}</td><td style="text-align:right">${i.amount.toLocaleString()}</td></tr>`,
      )
      .join("");
    const bank = bankDetailsHtml(invoice.artist);
    const payment = bank
      ? "using the bank details above or the payment link sent by SONUS"
      : "via the payment link sent by SONUS";
    return `<html><head><title>${escapeHtml(invoice.number)}</title><style>
      body{font-family:Helvetica,Arial,sans-serif;color:#0A0A0A;padding:48px;max-width:640px;margin:auto}
      h1{letter-spacing:3px;color:#00B24A;margin:0}
      .bar{border-top:4px solid #00FF66;margin:12px 0 24px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left;font-size:14px}
      .total{font-size:18px;font-weight:bold}
      .bank{margin-top:24px;padding:16px;border:1px solid #ddd;background:#fafafa}
      .bank h2{font-size:14px;letter-spacing:1px;margin:0 0 8px}
      .bank p{margin:4px 0;font-size:14px}
      .bank .muted{font-size:12px;color:#666;margin-top:10px}
    </style></head><body>
      <h1>SONUS</h1><div class="bar"></div>
      <p><strong>Invoice ${escapeHtml(invoice.number)}</strong><br/>
      Artist: ${escapeHtml(invoice.artist.stageName)} (${escapeHtml(invoice.artist.user.email)})<br/>
      Gig: ${escapeHtml(invoice.venue?.name ?? "Venue")}${invoice.venue?.address ? `, ${escapeHtml(invoice.venue.address)}` : ""}<br/>
      Date: ${new Date().toISOString().slice(0, 10)} · Status: ${escapeHtml(invoice.status)}</p>
      <table><tr><th>Item</th><th style="text-align:right">Amount</th></tr>${rows}
      <tr><td class="total">Total</td><td class="total" style="text-align:right">${invoice.total.toLocaleString()}</td></tr></table>
      ${bank}
      <p style="font-size:12px;color:#666;margin-top:32px">Payment: ${payment}. Please quote ${escapeHtml(invoice.number)} as the reference. Thank you for playing.</p>
    </body></html>`;
  }

  /**
   * Nudge the venue that a completed gig's invoice is still unpaid. The DJ owns
   * the invoice; the venue's manager is the account that actually pays it.
   */
  async remind(user: JwtUser, invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        artist: { select: { stageName: true, user: { select: { email: true } } } },
        venue: { select: { name: true, managerId: true } },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (user.role !== "admin" && invoice.artist.user.email !== user.email) throw new ForbiddenException();
    if (invoice.status === "paid") throw new BadRequestException("That invoice is already paid");
    if (!invoice.venue?.managerId) {
      throw new BadRequestException("The venue on this invoice has no manager account to remind");
    }

    const result = await this.notifications.deliver([invoice.venue.managerId], {
      kind: "invoice",
      title: `Invoice ${invoice.number} is due`,
      body: `${invoice.artist.stageName} is waiting on ${invoice.venue.name} for invoice ${invoice.number} — R${invoice.total.toLocaleString()}.`,
      link: `${(this.config.get<string>("APP_URL") ?? "https://essentialsedm.com").replace(/\/$/, "")}/venue`,
      channels: ["inapp"],
    });
    return { ...result, invoice: { id: invoice.id, number: invoice.number, total: invoice.total } };
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

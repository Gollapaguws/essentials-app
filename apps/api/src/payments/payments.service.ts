import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from "@nestjs/common";
import { prisma, PaymentStatus, InvoiceStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import type { PaymentProvider } from "./payment-provider.interface";
import { StripeProvider, PayfastProvider, SandboxProvider } from "./providers";
import { ConfigService } from "@nestjs/config";

/** Phase 4 in-app payments: checkout behind a provider interface, signed webhooks, reconciliation. */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private provider: PaymentProvider;

  constructor(private config: ConfigService) {
    const name = this.config.get("PAYMENT_PROVIDER") ?? "sandbox";
    this.provider =
      name === "stripe" && this.config.get("STRIPE_SECRET_KEY")
        ? new StripeProvider(this.config.get("STRIPE_SECRET_KEY")!, this.config)
        : name === "payfast"
          ? new PayfastProvider(this.config)
          : new SandboxProvider(this.config);
    this.logger.log(`payment provider: ${this.provider.name}`);
  }

  /** Start checkout for an invoice payment. */
  async checkout(user: JwtUser, invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { artist: { include: { user: true } }, payments: true },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    const isOwner = invoice.artist.user.email === user.email || invoice.artist.userId === user.sub;
    if (!isOwner && user.role !== "admin") throw new ForbiddenException("Not your invoice");
    if (invoice.status === InvoiceStatus.paid) throw new BadRequestException("Invoice already paid");

    const pending = invoice.payments.find((p) => p.status === PaymentStatus.pending);
    const appUrl = this.config.get("APP_URL") ?? "http://localhost:3001";
    const description = `ESSENTIALS invoice ${invoice.number} — ${invoice.artist.stageName}`;
    const checkout = await this.provider.createCheckout({
      reference: pending?.reference ?? invoice.number,
      amountMinor: invoice.total * 100,
      description,
      payerEmail: invoice.artist.user.email,
      successUrl: `${appUrl}/dashboard/artist?payment=success`,
      cancelUrl: `${appUrl}/dashboard/artist?payment=cancelled`,
    });

    if (pending) {
      await prisma.payment.update({ where: { id: pending.id }, data: { provider: this.provider.name } });
    } else {
      await prisma.payment.create({
        data: { invoiceId, provider: this.provider.name, reference: invoice.number, amount: invoice.total, status: PaymentStatus.pending },
      });
    }
    return { checkoutUrl: checkout.url, provider: this.provider.name, reference: checkout.providerRef ?? invoice.number };
  }

  /** Signed webhook: reconcile payment + invoice status. Idempotent. */
  async handleWebhook(providerName: string, rawBody: string, signature: string | undefined, parsed?: any) {
    if (providerName !== this.provider.name && this.provider.name !== "sandbox") {
      throw new BadRequestException("Unknown provider webhook");
    }
    if (!this.provider.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException("Invalid webhook signature");
    }
    const payload = parsed ?? JSON.parse(rawBody);
    const { reference, paid } = this.provider.extractReferenceAndStatus(payload);
    if (!reference) throw new BadRequestException("No reference in webhook");

    const payment = await prisma.payment.findFirst({ where: { reference }, include: { invoice: true } });
    if (!payment) throw new NotFoundException("Payment not found for reference");
    if (payment.status === PaymentStatus.paid) return { ok: true, idempotent: true };

    await prisma.payment.update({ where: { id: payment.id }, data: { status: paid ? PaymentStatus.paid : PaymentStatus.failed } });
    if (paid) {
      await prisma.invoice.update({ where: { id: payment.invoiceId }, data: { status: InvoiceStatus.paid } });
    }
    this.logger.log(`webhook reconciled: ${reference} -> ${paid ? "paid" : "failed"}`);
    return { ok: true };
  }

  /** Sandbox confirm (dev only): completes a pending payment without a real provider. */
  async sandboxConfirm(reference: string) {
    if (this.provider.name !== "sandbox") throw new ForbiddenException("Sandbox confirm only in sandbox mode");
    return this.handleWebhook("sandbox", JSON.stringify({ reference }), undefined, { reference });
  }
}

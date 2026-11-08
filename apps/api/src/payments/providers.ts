import { createHmac, timingSafeEqual } from "crypto";
import { ConfigService } from "@nestjs/config";
import type { PaymentProvider, CreatePaymentInput } from "./payment-provider.interface";

/** Stripe hosted checkout via REST (no SDK dependency). */
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  constructor(private key: string, private config: ConfigService) {}

  async createCheckout(input: CreatePaymentInput) {
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": this.config.get("CURRENCY") ?? "zar",
      "line_items[0][price_data][product_data][name]": input.description,
      "line_items[0][price_data][unit_amount]": String(input.amountMinor),
      "line_items[0][quantity]": "1",
      success_url: `${input.successUrl}?ref=${input.reference}`,
      cancel_url: input.cancelUrl,
      client_reference_id: input.reference,
      customer_email: input.payerEmail,
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json()) as {
      url?: string;
      id?: string;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json.error?.message ?? "Stripe checkout failed");
    return { url: json.url ?? "", providerRef: json.id };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined) {
    if (!signature) return false;
    // Without a configured secret the HMAC key would be empty, which anyone can
    // reproduce — never treat that as a valid signature.
    const secret = this.config.get<string>("STRIPE_WEBHOOK_SECRET");
    if (!secret) return false;
    const parts = Object.fromEntries(signature.split(",").map((p) => p.split("=") as [string, string]));
    // Stripe signs `<timestamp>.<body>`; reject stale timestamps so a captured
    // webhook cannot be replayed later.
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
    const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
    const provided = parts.v1 ?? "";
    try {
      return (
        expected.length === provided.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
      );
    } catch {
      return false;
    }
  }

  extractReferenceAndStatus(payload: unknown) {
    const p = (payload ?? {}) as {
      type?: string;
      data?: { object?: { client_reference_id?: string } };
    };
    const paid = p.type === "checkout.session.completed";
    return { reference: p.data?.object?.client_reference_id ?? "", paid };
  }
}

/** PayFast hosted payment page with MD5 signature. */
export class PayfastProvider implements PaymentProvider {
  readonly name = "payfast";
  constructor(private config: ConfigService) {}

  async createCheckout(input: CreatePaymentInput) {
    const fields: Record<string, string> = {
      merchant_id: this.config.get("PAYFAST_MERCHANT_ID") ?? "",
      merchant_key: this.config.get("PAYFAST_MERCHANT_KEY") ?? "",
      amount: (input.amountMinor / 100).toFixed(2),
      item_name: input.description,
      m_payment_id: input.reference,
      email_address: input.payerEmail,
      return_url: `${input.successUrl}?ref=${input.reference}`,
      cancel_url: input.cancelUrl,
      notify_url: `${this.config.get("APP_URL") ?? ""}/api/payments/webhook/payfast`,
    };
    // PayFast signature: concatenated values + passphrase, MD5
    const passphrase = this.config.get("PAYFAST_PASSPHRASE") ?? "";
    const ordered = Object.keys(fields).sort().map((k) => `${k}=${encodeURIComponent(fields[k]).replace(/%20/g, "+")}`);
    const signature = createHmac("md5", passphrase).update(`${ordered.join("&")}${passphrase ? `&passphrase=${encodeURIComponent(passphrase)}` : ""}`).digest("hex");
    const qs = new URLSearchParams({ ...fields, signature }).toString();
    const sandbox = this.config.get("PAYFAST_SANDBOX") === "true";
    return { url: `https://${sandbox ? "sandbox." : ""}payfast.io/eng/process?${qs}` };
  }

  verifyWebhookSignature(rawBody: string, _signature: string | undefined) {
    // PayFast signs with the merchant passphrase; an unset passphrase makes the
    // signature forgeable, so refuse the ITN instead of accepting it.
    const passphrase = this.config.get<string>("PAYFAST_PASSPHRASE");
    if (!passphrase) return false;
    const params = new URLSearchParams(rawBody);
    const provided = params.get("signature") ?? "";
    params.delete("signature");
    const ordered = [...params.keys()].sort().map((k) => `${k}=${encodeURIComponent(params.get(k) ?? "").replace(/%20/g, "+")}`);
    const expected = createHmac("md5", passphrase).update(`${ordered.join("&")}&passphrase=${encodeURIComponent(passphrase)}`).digest("hex");
    try {
      return (
        expected.length === provided.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
      );
    } catch {
      return false;
    }
  }

  extractReferenceAndStatus(payload: unknown) {
    // PayFast ITN posts form-encoded; parsed upstream into an object
    const p = (payload ?? {}) as { m_payment_id?: string; payment_status?: string };
    return { reference: p.m_payment_id ?? "", paid: p.payment_status === "COMPLETE" };
  }
}

/** Dev provider: returns a local confirm page and always verifies. */
export class SandboxProvider implements PaymentProvider {
  readonly name = "sandbox";
  constructor(private config: ConfigService) {}
  async createCheckout(input: CreatePaymentInput) {
    const base = this.config.get("APP_URL") ?? "http://localhost:3001";
    return { url: `${base}/pay/sandbox?ref=${input.reference}&amount=${input.amountMinor}` };
  }
  verifyWebhookSignature() { return true; }
  extractReferenceAndStatus(payload: unknown) {
    const p = (payload ?? {}) as { reference?: string };
    return { reference: p.reference ?? "", paid: true };
  }
}

/**
 * Swappable payment provider interface (Phase 4).
 * stripe   — hosted Checkout Sessions via REST (needs STRIPE_SECRET_KEY)
 * payfast  — PayFast process URL (needs PAYFAST_* env; signature generated)
 * sandbox  — dev provider: auto-confirms so flows can be tested end-to-end
 */
export interface CreatePaymentInput {
  reference: string;
  amountMinor: number;
  description: string;
  payerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CreatePaymentInput): Promise<{ url: string; providerRef?: string }>;
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean;
  extractReferenceAndStatus(payload: any): { reference: string; paid: boolean };
}

/**
 * Swappable email provider interface.
 * Phase 1: Resend (or Console for dev). Later: self-hosted listmonk (campaigns)
 * + Postal (MTA) behind this same interface — see docs/email-deliverability.md.
 */
export interface SendEmailInput {
  /** Overrides the configured From address (bulk newsletters send as newsletter@). */
  from?: string;
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Generated from the HTML when omitted. */
  text?: string;
  /** one-click unsubscribe URL (RFC 8058 ready) — required for bulk sends */
  unsubscribeUrl?: string;
}

export interface MailProvider {
  send(input: SendEmailInput): Promise<{ id: string }>;
}

/**
 * Swappable email provider interface.
 * Phase 1: Resend (or Console for dev). Later: self-hosted listmonk (campaigns)
 * + Postal (MTA) behind this same interface — see docs/email-deliverability.md.
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** one-click unsubscribe URL (RFC 8058 ready) — required for bulk sends */
  unsubscribeUrl?: string;
}

export interface MailProvider {
  send(input: SendEmailInput): Promise<{ id: string }>;
}

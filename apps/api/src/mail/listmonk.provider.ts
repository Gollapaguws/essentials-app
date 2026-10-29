import type { MailProvider, SendEmailInput } from "./mail-provider.interface";

/**
 * Phase 2 hook: self-hosted stack — listmonk (lists/campaigns/templates)
 * in front of Postal (MTA). Transactional email goes through listmonk's
 * transactional templates API; bulk campaigns are pushed via the campaigns API.
 *
 * Activate with MAIL_PROVIDER=listmonk plus the LISTMONK_* env vars below.
 * Runbook: create a "essentials-guests" list, one transactional template per
 * flow (welcome, weekly_drop, reminder_24h, reminder_1h, winback), then point
 * listmonk's SMTP settings at Postal.
 */
export class ListmonkProvider implements MailProvider {
  constructor(
    private baseUrl = process.env.LISTMONK_URL ?? "",
    private user = process.env.LISTMONK_API_USER ?? "",
    private token = process.env.LISTMONK_API_TOKEN ?? "",
    private listId = parseInt(process.env.LISTMONK_LIST_ID ?? "1", 10),
  ) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${this.user}:${this.token}`).toString("base64")}`,
    };
  }

  /** Upsert subscriber + granted consent, then send transactional template. */
  async send(input: SendEmailInput) {
    if (!this.baseUrl) throw new Error("LISTMONK_URL not configured");
    // 1. ensure subscriber
    const subRes = await fetch(`${this.baseUrl}/api/subscribers`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        email: input.to,
        name: input.to.split("@")[0],
        lists: [this.listId],
        status: "enabled",
        preconfirm_subscriptions: true,
      }),
    });
    const sub = (await subRes.json().catch(() => null)) as { data?: { id?: number } } | null;
    // 2. transactional send (listmonk >= v3 supports tx templates via /api/tx)
    const txRes = await fetch(`${this.baseUrl}/api/tx`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        subscriber_email: input.to,
        template_id: parseInt(process.env.LISTMONK_TX_TEMPLATE_ID ?? "1", 10),
        data: { subject: input.subject, body_html: input.html, unsubscribe_url: input.unsubscribeUrl ?? "" },
      }),
    });
    const tx = (await txRes.json().catch(() => null)) as { data?: { id?: number } } | null;
    return { id: `listmonk-${sub?.data?.id ?? "?"}-${tx?.data?.id ?? Date.now()}` };
  }
}

/**
 * The provider refused a send because its quota or rate limit is exhausted.
 * Callers should wait for the quota window to reopen instead of treating the
 * message as undeliverable.
 */
export class MailQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailQuotaError";
  }
}

/** Provider errors that mean "come back later", not "this address is bad". */
export function isQuotaError(name: string | undefined, message: string): boolean {
  return /rate_limit|quota/i.test(name ?? "") || /quota|rate limit|too many requests/i.test(message);
}

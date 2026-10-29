import type { MailProvider, SendEmailInput } from "./mail-provider.interface";

/** Dev provider: logs the email instead of sending. */
export class ConsoleMailProvider implements MailProvider {
  async send(input: SendEmailInput) {
    console.log(`\n=== EMAIL (console provider) ===\nTo: ${input.to}\nSubject: ${input.subject}\n${input.html}\n`);
    return { id: `console-${Date.now()}` };
  }
}

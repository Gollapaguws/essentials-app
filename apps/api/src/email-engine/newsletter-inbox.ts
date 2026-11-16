import { BadRequestException } from "@nestjs/common";
import { simpleParser } from "mailparser";

/** The only mailbox allowed to submit a newsletter. */
export const NEWSLETTER_CURATOR = "curator@essentialsedm.com";
/** The engine-only mailbox that receives the attachment. */
export const NEWSLETTER_INBOX = "newsletter@essentialsedm.com";
/** Bulk mail leaves as this address; it is not a human inbox. */
export const NEWSLETTER_FROM = "ESSENTIALS <newsletter@essentialsedm.com>";

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export interface InboundNewsletter {
  from: string;
  subject: string;
  filename: string;
  html: string;
}

function isHtmlAttachment(filename: string, contentType: string) {
  return /\.html?$/i.test(filename) || contentType.toLowerCase() === "text/html";
}

/**
 * Read a raw message delivered to newsletter@. The newsletter itself is the
 * HTML file attached to the curator's email; the message body is only a cover
 * note, so a message without an HTML attachment is rejected rather than sent.
 */
export async function parseNewsletterEmail(raw: Buffer): Promise<InboundNewsletter> {
  if (!raw.length) throw new BadRequestException("The newsletter email was empty");

  let parsed;
  try {
    parsed = await simpleParser(raw);
  } catch {
    throw new BadRequestException("The newsletter email could not be read");
  }

  const from = parsed.from?.value?.[0]?.address?.trim().toLowerCase() ?? "";
  const subject = (parsed.subject ?? "").trim() || "ESSENTIALS newsletter";

  const attachment = parsed.attachments.find((file) =>
    isHtmlAttachment(file.filename ?? "", file.contentType ?? ""),
  );
  if (!attachment) {
    throw new BadRequestException("Attach the newsletter as an .html file");
  }
  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new BadRequestException("The newsletter attachment must be 2 MB or smaller");
  }

  const html = attachment.content.toString("utf8").trim();
  if (!html) throw new BadRequestException("The newsletter attachment was empty");

  return {
    from,
    subject,
    filename: attachment.filename ?? "newsletter.html",
    html,
  };
}

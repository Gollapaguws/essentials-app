jest.mock("resend", () => ({ Resend: jest.fn() }));

import { Resend } from "resend";
import { MailService } from "./mail.service";
import { MailQuotaError } from "./mail-quota.error";

const send = jest.fn();

function service() {
  (Resend as unknown as jest.Mock).mockImplementation(() => ({ emails: { send } }));
  const config = {
    get: (key: string) =>
      ({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test", MAIL_FROM: "ESSENTIALS <hello@essentialsedm.com>" })[key],
  };
  return new MailService(config as never);
}

describe("MailService with the Resend provider", () => {
  beforeEach(() => send.mockReset());

  it("throws when Resend rejects the message", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The example.invalid domain is not verified", statusCode: 403 },
    });

    await expect(
      service().send({ to: "guest@example.com", subject: "Hello", html: "<p>Hello</p>" }),
    ).rejects.toThrow(/domain is not verified/);
  });

  it("flags quota rejections as retryable instead of undeliverable", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "You have reached your daily email sending quota.", statusCode: 429 },
    });

    await expect(service().send({ to: "guest@example.com", subject: "Hello", html: "<p>Hello</p>" })).rejects.toBeInstanceOf(
      MailQuotaError,
    );
  });

  it("throws when Resend returns neither an id nor an error", async () => {
    send.mockResolvedValue({ data: null, error: null });

    await expect(service().send({ to: "guest@example.com", subject: "Hello", html: "<p>Hello</p>" })).rejects.toThrow(
      /no id/,
    );
  });

  it("returns the provider id for an accepted send", async () => {
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });

    await expect(service().send({ to: "guest@example.com", subject: "Hello", html: "<p>Hello</p>" })).resolves.toEqual({
      id: "email_123",
    });
  });
});

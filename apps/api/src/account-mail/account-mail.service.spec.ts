import { ConfigService } from "@nestjs/config";
import { createTransport } from "nodemailer";
import { AccountMailService, renderAccountNotice } from "./account-mail.service";

jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

const createTransportMock = createTransport as jest.MockedFunction<typeof createTransport>;

function config(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("renderAccountNotice", () => {
  it("describes a role change as a service message, not a newsletter", () => {
    const rendered = renderAccountNotice(
      { kind: "role-changed", from: "guest", to: "artist" },
      { appUrl: "https://essentialsedm.com" },
    );

    expect(rendered.subject).toBe("Your ESSENTIALS account access changed");
    expect(rendered.text).toContain("from guest to DJ");
    expect(rendered.text).toContain("https://essentialsedm.com");
    expect(rendered.text).toContain("not a newsletter");
    expect(rendered.text).not.toMatch(/unsubscribe/i);
  });

  it("escapes interpolated values in the HTML part", () => {
    const rendered = renderAccountNotice(
      { kind: "role-changed", from: "<script>", to: "artist" },
      { appUrl: "https://essentialsedm.com" },
    );

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("lays a statement out with each gig and the month's totals", () => {
    const rendered = renderAccountNotice(
      {
        kind: "statement",
        month: "2027-03",
        dj: "DJ Nova",
        gigs: [
          {
            date: "2027-03-13",
            night: "Amapiano Sunrise",
            venue: "The Warehouse",
            slot: "20:00–21:00",
            fee: 500,
            travel: 100,
            invoiced: 600,
            paid: 0,
            invoice: "INV-1",
            status: "sent",
          },
        ],
        totals: { agreed: 600, invoiced: 600, paid: 0, outstanding: 600 },
      },
      { appUrl: "https://essentialsedm.com/dashboard" },
    );

    expect(rendered.subject).toBe("Your 2027-03 ESSENTIALS statement");
    expect(rendered.text).toContain("as DJ Nova");
    expect(rendered.text).toContain("Amapiano Sunrise at The Warehouse");
    expect(rendered.text).toContain("outstanding R600");
    expect(rendered.text).toContain("https://essentialsedm.com/dashboard");
    expect(rendered.text).not.toMatch(/unsubscribe/i);
  });

  it("states whether two-step verification was on or off", () => {
    const off = renderAccountNotice({ kind: "mfa-changed", enabled: false }, { appUrl: "https://x.test" });
    const on = renderAccountNotice({ kind: "mfa-changed", enabled: true }, { appUrl: "https://x.test" });

    expect(off.text).toContain("turned off");
    expect(on.text).toContain("turned back on");
  });
});

describe("AccountMailService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stays disabled when no sender is configured", async () => {
    const service = new AccountMailService(config({ SMTP_HOST: "127.0.0.1" }));

    expect(service.enabled).toBe(false);
    await expect(service.send("dj@example.test", { kind: "sign-in-reset" })).resolves.toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("sends through the configured relay", async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    createTransportMock.mockReturnValue({ sendMail } as never);

    const service = new AccountMailService(
      config({
        SMTP_HOST: "127.0.0.1",
        ACCOUNT_MAIL_FROM: "ESSENTIALS <no-reply@essentialsedm.com>",
        APP_URL: "https://essentialsedm.com/",
      }),
    );

    await expect(
      service.send("dj@example.test", { kind: "mfa-changed", enabled: false }),
    ).resolves.toBe(true);

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: "127.0.0.1", port: 25 }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "ESSENTIALS <no-reply@essentialsedm.com>",
        to: "dj@example.test",
        subject: "Two-step verification changed on your ESSENTIALS account",
      }),
    );
    expect(sendMail.mock.calls[0][0].text).toContain("https://essentialsedm.com");
  });

  it("returns false instead of failing the caller when the relay rejects", async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    createTransportMock.mockReturnValue({ sendMail } as never);

    const service = new AccountMailService(
      config({
        SMTP_HOST: "127.0.0.1",
        ACCOUNT_MAIL_FROM: "ESSENTIALS <no-reply@essentialsedm.com>",
      }),
    );

    await expect(service.send("dj@example.test", { kind: "sign-in-reset" })).resolves.toBe(false);
  });
});

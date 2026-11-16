import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { EmailEngineService } from "./email-engine.service";
import { parseNewsletterEmail } from "./newsletter-inbox";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  ConsentStatus: { granted: "granted", revoked: "revoked" },
  EventStatus: {},
  prisma: {
    emailSegment: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    campaign: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    consent: { findUnique: jest.fn() },
    emailJob: { create: jest.fn() },
  },
}));

const db = prisma as unknown as {
  emailSegment: { findUnique: jest.Mock };
  user: { findMany: jest.Mock };
  campaign: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  consent: { findUnique: jest.Mock };
  emailJob: { create: jest.Mock };
};

const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };
const service = () => new EmailEngineService();

/** A message shaped like the curator's: HTML body attached, cover note inline. */
function newsletterEmail(from: string, filename = "newsletter.html", html = "<h1>DROP</h1>") {
  return Buffer.from(
    [
      `From: ${from}`,
      "To: newsletter@essentialsedm.com",
      "Subject: ESSENTIALS weekly drop",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="B"',
      "",
      "--B",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Newsletter attached.",
      "--B",
      `Content-Type: ${/\.html?$/i.test(filename) ? "text/html" : "application/pdf"}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(html).toString("base64"),
      "--B--",
      "",
    ].join("\r\n"),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  db.user.findMany.mockResolvedValue([]);
  db.consent.findUnique.mockResolvedValue({ status: "granted" });
  db.emailJob.create.mockResolvedValue({ id: "job-1" });
  db.campaign.update.mockResolvedValue({});
});

describe("newsletter email parsing", () => {
  it("uses the HTML attachment, not the cover note", async () => {
    const mail = await parseNewsletterEmail(newsletterEmail("curator@essentialsedm.com"));
    expect(mail).toMatchObject({
      from: "curator@essentialsedm.com",
      subject: "ESSENTIALS weekly drop",
      filename: "newsletter.html",
      html: "<h1>DROP</h1>",
    });
  });

  it("rejects a message without an HTML attachment", async () => {
    await expect(parseNewsletterEmail(newsletterEmail("curator@essentialsedm.com", "notes.pdf"))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("EmailEngineService newsletter inbox", () => {
  it("stores a draft when the curator sends the newsletter", async () => {
    db.campaign.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "campaign-9", ...data }),
    );

    const result = await service().ingestNewsletter(newsletterEmail("curator@essentialsedm.com"));

    expect(db.campaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ flow: "newsletter", status: "draft", contentHtml: "<h1>DROP</h1>" }),
    });
    expect(result).toMatchObject({ ok: true, campaignId: "campaign-9", subject: "ESSENTIALS weekly drop" });
  });

  it("refuses a newsletter from any other sender", async () => {
    await expect(service().ingestNewsletter(newsletterEmail("someone@example.com"))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.campaign.create).not.toHaveBeenCalled();
  });

  it("previews the stored HTML wrapped with an unsubscribe link", async () => {
    db.campaign.findUnique.mockResolvedValue({
      id: "campaign-9",
      name: "Newsletter",
      subject: "Drop",
      flow: "newsletter",
      status: "draft",
      contentHtml: "<p>Body</p>",
      segment: null,
    });

    const result = await service().previewCampaign(promoter, "campaign-9");

    expect(result.html).toContain("<p>Body</p>");
    expect(result.html).toContain("Unsubscribe");
    expect(result.from).toContain("newsletter@essentialsedm.com");
  });

  it("releases a draft to consenting recipients", async () => {
    db.campaign.findUnique.mockResolvedValue({ id: "campaign-9", status: "draft", contentHtml: "<p>Body</p>", segmentId: null });
    db.user.findMany.mockResolvedValue([{ id: "user-1", email: "guest@example.com", name: "Guest" }]);

    const result = await service().sendCampaign(promoter, "campaign-9");

    expect(db.emailJob.create).toHaveBeenCalledWith({ data: { campaignId: "campaign-9", userId: "user-1" } });
    expect(result).toEqual({ campaignId: "campaign-9", queued: 1 });
  });

  it("will not send a campaign twice", async () => {
    db.campaign.findUnique.mockResolvedValue({ id: "campaign-9", status: "sending", contentHtml: "<p>Body</p>" });

    await expect(service().sendCampaign(promoter, "campaign-9")).rejects.toBeInstanceOf(BadRequestException);
    expect(db.emailJob.create).not.toHaveBeenCalled();
  });
});

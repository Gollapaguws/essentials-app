import { type AddressInfo, createServer, type Server, type Socket } from "net";
import { Logger, type INestApplication, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { MailModule } from "./mail.module";

/** Port 1 has nothing behind it, so the probe's connect is refused outright. */
const CLOSED_PORT = 1;

/** Read by the config factory at bootstrap, so each test can point at its own relay. */
let smtpPort = CLOSED_PORT;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [() => ({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtpPort) })],
    }),
    // The real module rather than a hand-rolled one: if the controller ever drops
    // out of its controllers list, this test gets a 404 instead of a silent pass.
    MailModule,
  ],
})
class TestMailModule {}

/** Boots the API the way main.ts does — global "api" prefix, real driver port. */
async function bootApi(): Promise<{ app: INestApplication; url: string }> {
  const app = await NestFactory.create(TestMailModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}/api/mail/status` };
}

describe("GET /api/mail/status", () => {
  let app: INestApplication | null = null;
  let relay: Server | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    const openRelay = relay;
    relay = null;
    if (openRelay) await new Promise<void>((resolve) => openRelay.close(() => resolve()));
  });

  it("reports down when the SMTP probe fails", async () => {
    smtpPort = CLOSED_PORT;
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    const booted = await bootApi();
    app = booted.app;
    const response = await fetch(booted.url);
    const body = (await response.json()) as { ok?: unknown; checkedAt?: unknown };

    // Down is a health answer, not an error: the sign-in page must be able to read it.
    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(Number.isNaN(Date.parse(String(body.checkedAt)))).toBe(false);
    // Only the verdict crosses the wire — the relay address stays server-side.
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "ok"]);
    // Whoever is on call needs the failure in the logs, with the reason.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("is not answering"));

    warn.mockRestore();
  });

  it("reports ok when the relay greets and answers", async () => {
    const relayServer = createServer((socket: Socket) => {
      socket.write("220 test ESMTP Postfix\r\n");
      socket.once("data", () => socket.write("250-mail-status\r\n250 OK\r\n"));
    });
    relay = relayServer;
    await new Promise<void>((resolve) => relayServer.listen(0, "127.0.0.1", () => resolve()));
    smtpPort = (relayServer.address() as AddressInfo).port;

    const booted = await bootApi();
    app = booted.app;
    const body = (await (await fetch(booted.url)).json()) as { ok?: unknown };

    expect(body.ok).toBe(true);
  });
});

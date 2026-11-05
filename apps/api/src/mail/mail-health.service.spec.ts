import { createServer, type AddressInfo, type Server, type Socket } from "net";
import { probeSmtp } from "./mail-health.service";

describe("probeSmtp", () => {
  let server: Server | null = null;
  let port = 0;

  const listen = (onConnection: (socket: Socket) => void) =>
    new Promise<void>((resolve) => {
      const created = createServer(onConnection);
      created.listen(0, "127.0.0.1", () => {
        port = (created.address() as AddressInfo).port;
        resolve();
      });
      server = created;
    });

  afterEach(async () => {
    const open = server;
    server = null;
    if (open) await new Promise<void>((resolve) => open.close(() => resolve()));
  });

  it("accepts a relay that greets and answers EHLO", async () => {
    await listen((socket) => {
      socket.write("220 test ESMTP Postfix\r\n");
      socket.once("data", () => socket.write("250-mail-status\r\n250 OK\r\n"));
    });

    await expect(probeSmtp("127.0.0.1", port)).resolves.toEqual({ ok: true });
  });

  it("reports down when nothing is listening", async () => {
    await expect(probeSmtp("127.0.0.1", 1, 500)).resolves.toMatchObject({ ok: false });
  });

  it("reports down when the port accepts but never greets", async () => {
    await listen(() => {
      /* hold the connection open, say nothing */
    });

    await expect(probeSmtp("127.0.0.1", port, 150)).resolves.toMatchObject({ ok: false });
  });

  it("reports down when something other than SMTP answers", async () => {
    await listen((socket) => socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"));

    await expect(probeSmtp("127.0.0.1", port, 500)).resolves.toEqual({
      ok: false,
      reason: "not an SMTP banner",
    });
  });
});

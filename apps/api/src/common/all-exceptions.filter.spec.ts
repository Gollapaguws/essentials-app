import { BadRequestException, Logger, ServiceUnavailableException } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

interface Sent {
  status: number;
  body: Record<string, unknown>;
}

function run(exception: unknown, requestId?: string): Sent {
  const sent: Sent = { status: 0, body: {} };
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
      return this;
    },
  };
  const host = {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => ({ method: "POST", url: "/api/events", id: requestId }),
      getResponse: () => res,
    }),
  } as never;
  new AllExceptionsFilter().catch(exception, host);
  return sent;
}

describe("AllExceptionsFilter", () => {
  beforeEach(() => {
    // The filter logs by design; keep the test output readable.
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("turns an unexpected throw into a 500 that leaks nothing but the request id", () => {
    const { status, body } = run(new Error("connect ECONNREFUSED 10.0.0.5:5432"), "req-12345678");
    expect(status).toBe(500);
    expect(body.message).toBe("Something went wrong on our side.");
    expect(body.requestId).toBe("req-12345678");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });

  it("keeps validation messages intact, including the array class-validator sends", () => {
    const { status, body } = run(
      new BadRequestException({ message: ["title should not be empty", "capacity must be a number"], error: "Bad Request" }),
    );
    expect(status).toBe(400);
    expect(body.message).toEqual(["title should not be empty", "capacity must be a number"]);
    expect(body.error).toBe("Bad Request");
  });

  it("masks a deliberate 5xx too, while keeping the status", () => {
    const { status, body } = run(new ServiceUnavailableException("supabase unreachable"));
    expect(status).toBe(503);
    expect(body.message).toBe("Something went wrong on our side.");
  });
});

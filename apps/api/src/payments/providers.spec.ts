import { ConfigService } from "@nestjs/config";
import { PayfastProvider, SandboxProvider, StripeProvider } from "./providers";
import type { CreatePaymentInput } from "./payment-provider.interface";

function mockConfig(values: Record<string, string | undefined> = {}) {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const input: CreatePaymentInput = {
  reference: "REF-1",
  amountMinor: 25000,
  description: "Door pass",
  payerEmail: "guest@example.com",
  successUrl: "https://app.example.com/pay/success",
  cancelUrl: "https://app.example.com/pay/cancel",
};

/** Only `ok`, `status` and `json()` are read from the response. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("StripeProvider.createCheckout", () => {
  const provider = () => new StripeProvider("sk_test", mockConfig({ CURRENCY: "zar" }));

  it("returns the hosted checkout url and session id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "cs_123", url: "https://checkout.stripe.com/c/pay/cs_123" }),
    );

    await expect(provider().createCheckout(input)).resolves.toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_123",
      providerRef: "cs_123",
    });
  });

  it("surfaces the provider's error message on a failed session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "card declined" } }, false, 402));

    await expect(provider().createCheckout(input)).rejects.toThrow("card declined");
  });

  it("falls back to a generic message when Stripe sends no error body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));

    await expect(provider().createCheckout(input)).rejects.toThrow("Stripe checkout failed");
  });

  it("keeps url a string when the session carries no url", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "cs_1" }));

    await expect(provider().createCheckout(input)).resolves.toEqual({ url: "", providerRef: "cs_1" });
  });
});

describe("StripeProvider.extractReferenceAndStatus", () => {
  const provider = new StripeProvider("sk_test", mockConfig());

  it("reads the reference from a completed checkout session", () => {
    expect(
      provider.extractReferenceAndStatus({
        type: "checkout.session.completed",
        data: { object: { client_reference_id: "REF-1" } },
      }),
    ).toEqual({ reference: "REF-1", paid: true });
  });

  it("does not mark any other event type as paid", () => {
    expect(
      provider.extractReferenceAndStatus({
        type: "checkout.session.expired",
        data: { object: { client_reference_id: "REF-1" } },
      }),
    ).toEqual({ reference: "REF-1", paid: false });
  });

  it("returns an empty reference when the session object is missing", () => {
    expect(provider.extractReferenceAndStatus({ type: "checkout.session.completed", data: {} })).toEqual({
      reference: "",
      paid: true,
    });
  });
});

describe("PayfastProvider.extractReferenceAndStatus", () => {
  const provider = new PayfastProvider(mockConfig());

  it("reads the reference and paid state from an ITN", () => {
    expect(provider.extractReferenceAndStatus({ m_payment_id: "REF-2", payment_status: "COMPLETE" })).toEqual({
      reference: "REF-2",
      paid: true,
    });
  });

  it("treats a non-COMPLETE status as unpaid", () => {
    expect(provider.extractReferenceAndStatus({ m_payment_id: "REF-2", payment_status: "FAILED" })).toEqual({
      reference: "REF-2",
      paid: false,
    });
  });
});

describe("SandboxProvider.extractReferenceAndStatus", () => {
  const provider = new SandboxProvider(mockConfig());

  it("reads the reference and always confirms", () => {
    expect(provider.extractReferenceAndStatus({ reference: "REF-3" })).toEqual({
      reference: "REF-3",
      paid: true,
    });
  });
});

type Extractor = { extractReferenceAndStatus(payload: unknown): { reference: string; paid: boolean } };

const extractors: [string, () => Extractor][] = [
  ["stripe", () => new StripeProvider("sk_test", mockConfig())],
  ["payfast", () => new PayfastProvider(mockConfig())],
  ["sandbox", () => new SandboxProvider(mockConfig())],
];

for (const [name, make] of extractors) {
  describe(`${name} payload narrowing`, () => {
    // The webhook body is untrusted input, so anything can arrive here.
    it.each([[null], [undefined], [{}], ["ITN body"], [42], [[]], [{ data: null }]])(
      "returns an empty reference for %p without throwing",
      (payload) => {
        expect(make().extractReferenceAndStatus(payload)).toMatchObject({ reference: "" });
      },
    );
  });
}

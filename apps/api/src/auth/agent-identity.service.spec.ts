import { createHmac } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import { AgentIdentityService } from "./agent-identity.service";

const config = (secret?: string) =>
  ({
    get: (key: string) => (key === "JOTFORM_AGENT_SECRET" ? secret : undefined),
  }) as unknown as ConfigService;

describe("AgentIdentityService", () => {
  it("signs the user id the way Jotform expects", () => {
    const { userID, userHash } = new AgentIdentityService(config("agent-secret")).sign("user-1");

    expect(userID).toBe("user-1");
    // Same construction as the documented Python: hmac(secret, userId, sha256).hexdigest()
    expect(userHash).toBe(createHmac("sha256", "agent-secret").update("user-1").digest("hex"));
    expect(userHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("gives different accounts different hashes", () => {
    const service = new AgentIdentityService(config("agent-secret"));

    expect(service.sign("user-1").userHash).not.toBe(service.sign("user-2").userHash);
  });

  it("reports itself unconfigured without a secret, so the widget stays anonymous", () => {
    expect(new AgentIdentityService(config()).configured).toBe(false);
    expect(new AgentIdentityService(config("")).configured).toBe(false);
    expect(new AgentIdentityService(config("agent-secret")).configured).toBe(true);
  });
});

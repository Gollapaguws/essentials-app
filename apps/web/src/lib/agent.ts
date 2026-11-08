/** Jotform support agent embed. The agent id is public; the secret is not here. */
export const JOTFORM_AGENT_SRC =
  "https://cdn.jotfor.ms/agent/embedjs/01a1babe34f070008319a590f5cfe59b9d41/embed.js";

export interface AgentIdentity {
  userID: string;
  userHash: string;
  metadata?: Record<string, string | undefined>;
}

declare global {
  interface Window {
    _jfAgentIdentifiedUser?: AgentIdentity;
    AgentClientSDK?: { resetUser(): void };
  }
}

/**
 * Tell the widget who is signed in. The hash is signed by the API with the agent
 * secret, so the browser cannot claim to be somebody else.
 */
export function identifyAgentUser(identity: AgentIdentity): void {
  window._jfAgentIdentifiedUser = identity;
}

/** Sign-out must not leave the previous account named in the chat widget. */
export function resetAgentUser(): void {
  delete window._jfAgentIdentifiedUser;
  window.AgentClientSDK?.resetUser?.();
}

/** Jotform support agent embed. The agent id is public; the secret is not here. */
export const JOTFORM_AGENT_SRC =
  "https://cdn.jotfor.ms/agent/embedjs/01a1babe34f070008319a590f5cfe59b9d41/embed.js";

/**
 * Screen names for the agent. Keys are dashboard paths as `usePathname`
 * reports them (the `/dashboard` base is already stripped), so "this button"
 * can be tied to the page it is on.
 */
const SCREENS: Record<string, string> = {
  "/": "Analytics",
  "/events": "Events",
  "/email": "Email Engine",
  "/venue": "Venue Portal",
  "/artists": "Artists",
  "/promotions": "Promotions",
  "/artist": "Artist Portal",
  "/artist/profile": "My Profile",
  "/insights": "Insights",
  "/editor": "Front Page",
  "/mailboxes": "Mailboxes",
  "/simulcast": "Streaming",
  "/social": "Social Hub",
  "/gig-calendar": "Gig Calendar",
  "/earnings": "Earnings",
  "/applications": "DJ Applications",
  "/door": "Door",
  "/settlements": "Settlements",
  "/notifications": "Notifications",
  "/account": "Account",
  "/users": "Users",
  "/audit": "Audit",
  "/settings": "Settings",
  // Not dashboard screens, but the places sign-in problems happen.
  "/login": "Sign in",
  "/auth/mfa": "Two-factor check",
  "/auth/password": "Password reset",
};

/** A readable screen name, falling back to the path itself for unknown routes. */
export function screenName(pathname: string): string {
  return SCREENS[pathname] ?? pathname;
}

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

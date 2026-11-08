"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { session } from "@/lib/session";
import { JOTFORM_AGENT_SRC, identifyAgentUser, screenName } from "@/lib/agent";

/**
 * The support agent loads on every dashboard page. Once someone is signed in,
 * the API signs their id with the agent secret — the browser only ever holds the
 * hash — so the conversation is tied to the account rather than an email the
 * visitor typed.
 */
export function AgentChat() {
  const { me } = useAuth();
  const screen = screenName(usePathname());
  // Read by the identity call below without making it re-run on every nav.
  const screenRef = useRef(screen);

  // Dashboard navigation is client-side, so the widget's screen label has to be
  // patched in place rather than re-fetched from the API.
  useEffect(() => {
    screenRef.current = screen;
    const identity = window._jfAgentIdentifiedUser;
    if (identity?.metadata) identity.metadata.page = screen;
  }, [screen]);

  useEffect(() => {
    if (!me) return;
    let active = true;
    session
      .agentIdentity()
      .then(({ userID, userHash, context }) => {
        if (!active) return;
        // The manual tells the agent what these keys mean: counts are live and
        // role-specific, and `states` explains the common dead ends (no password
        // chosen yet, a DJ role with no profile), so it can answer without guessing.
        identifyAgentUser({
          userID,
          userHash,
          metadata: {
            email: me.user.email,
            role: context.role,
            page: screenRef.current,
            summary: context.summary,
            ...context.states,
            ...Object.fromEntries(
              Object.entries(context.facts).map(([key, value]) => [key, String(value)]),
            ),
          },
        });
      })
      // Anonymous chat still works; a signed id is an improvement, not a requirement.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [me]);

  return <Script src={JOTFORM_AGENT_SRC} strategy="afterInteractive" />;
}

"use client";

import Script from "next/script";
import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { session } from "@/lib/session";
import { JOTFORM_AGENT_SRC, identifyAgentUser } from "@/lib/agent";

/**
 * The support agent loads on every dashboard page. Once someone is signed in,
 * the API signs their id with the agent secret — the browser only ever holds the
 * hash — so the conversation is tied to the account rather than an email the
 * visitor typed.
 */
export function AgentChat() {
  const { me } = useAuth();

  useEffect(() => {
    if (!me) return;
    let active = true;
    session
      .agentIdentity()
      .then(({ userID, userHash, context }) => {
        if (!active) return;
        // The manual tells the agent what these keys mean; counts are live and
        // role-specific, so it can answer "what do I owe?" without guessing.
        identifyAgentUser({
          userID,
          userHash,
          metadata: {
            email: me.user.email,
            role: context.role,
            summary: context.summary,
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

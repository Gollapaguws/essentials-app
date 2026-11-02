import { useEffect, useState } from "react";
import { defaultContent } from "@/data/siteContent";

const API_URL = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";

/** Front-page content: server overrides (admin editor) merged over shipped defaults. */
export function useSiteContent() {
  const [content, setContent] = useState(defaultContent);

  useEffect(() => {
    fetch(`${API_URL}/site/content`)
      .then((r) => r.json())
      .then((remote) => {
        const { updatedAt, ...overrides } = remote ?? {};
        setContent({ ...defaultContent, ...overrides });
      })
      .catch(() => {});
  }, []);

  return content;
}

import { useEffect, useState } from "react";
import { defaultContent } from "@/data/siteContent";
import { API_BASE } from "@/lib/apiBase";

const API_URL = API_BASE;

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

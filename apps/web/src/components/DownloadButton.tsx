"use client";

import { useState } from "react";
import { downloadFromApi } from "@/lib/download";
import { errorMessage } from "@/lib/errors";

/** Exports are bearer-guarded, so the download has to go through fetch. */
export function DownloadButton({
  path,
  filename,
  label,
  className = "text-neutral-300 underline text-xs",
}: {
  path: string;
  filename: string;
  label: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await downloadFromApi(path, filename);
        } catch (e) {
          setError(errorMessage(e) ?? "Download failed");
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      title={error ?? undefined}
      className={`${className} disabled:opacity-50`}
    >
      {error ? "RETRY" : busy ? "…" : label}
    </button>
  );
}

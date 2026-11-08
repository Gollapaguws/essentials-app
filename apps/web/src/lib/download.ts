/**
 * Fetch an export from the API and hand it to the browser as a file. Export
 * routes are role-guarded; the dashboard's httpOnly session cookie rides along
 * because this is a same-site request.
 */
export async function downloadFromApi(path: string, filename: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    credentials: "include",
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      const raw = body?.message ?? message;
      message = Array.isArray(raw) ? raw.join(", ") : raw;
    } catch {
      // Not JSON: the status is all we have.
    }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

import { supabase } from "./supabase";

/**
 * Fetch an export from the API with the session's bearer token and hand it to the
 * browser as a file. Export routes are role-guarded, so a plain <a href> cannot
 * work: the token has to travel in the Authorization header.
 */
export async function downloadFromApi(path: string, filename: string) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
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

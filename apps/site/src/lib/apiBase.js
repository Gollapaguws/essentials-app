/**
 * Where the public site talks to its API, and the host it calls itself.
 *
 * nginx serves the API on the same vhost as the site (`/api/`), so requests are
 * made to whatever origin the page was loaded from. That keeps them same-origin
 * on every host we serve — essentialsedm.com and sonus.essentialsedm.com alike —
 * so no CORS or cookie is involved in reading a lineup.
 *
 * `VITE_API_URL` is only for pointing a local dev server at a deployed API.
 */
export const API_BASE = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;

/**
 * The canonical host. Anything that leaves the browser — share cards, og:url,
 * the sitemap — has to be absolute, and has to agree on one host, so it is
 * pinned here rather than derived from window.location.
 */
export const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://sonus.essentialsedm.com").replace(/\/$/, "");

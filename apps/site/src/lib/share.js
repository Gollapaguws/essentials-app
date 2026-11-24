import { SITE_URL } from "@/lib/apiBase";

const SITE = SITE_URL;

const DEFAULTS = {
  title: "ESSENTIALS — Music Events",
  description:
    "ESSENTIALS — a South African music events collective. Underground rooms, real sound systems, lineups built for the floor.",
  image: `${SITE}/og-default.png`,
  path: "/",
};

const limit = (value, max) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** Create or update a <meta>, keyed by `property=` or `name=`. */
function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Per-page title and share metadata.
 *
 * This is a client-rendered SPA, so crawlers that execute JavaScript (Google,
 * and every social unfurler we care about reads the served HTML) need the tags to
 * be real elements in <head>, not just a document.title assignment. Call it on
 * mount of every route: a stale event title is worse than a generic one, so the
 * default is applied whenever no page claims the route.
 *
 * @param {{ title?: string, description?: string, image?: string, path?: string, type?: string }} [meta]
 */
export function setPageMeta({ title, description, image, path, type = "website" } = {}) {
  const resolved = {
    title: title ? `${limit(title, 70)} · ESSENTIALS` : DEFAULTS.title,
    description: limit(description || DEFAULTS.description, 200),
    image: image || DEFAULTS.image,
    url: `${SITE}${path ?? DEFAULTS.path}`,
  };

  document.title = resolved.title;
  upsertMeta("name", "description", resolved.description);

  upsertMeta("property", "og:site_name", "ESSENTIALS");
  upsertMeta("property", "og:type", type);
  upsertMeta("property", "og:title", resolved.title);
  upsertMeta("property", "og:description", resolved.description);
  upsertMeta("property", "og:image", resolved.image);
  upsertMeta("property", "og:url", resolved.url);

  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", resolved.title);
  upsertMeta("name", "twitter:description", resolved.description);
  upsertMeta("name", "twitter:image", resolved.image);

  upsertCanonical(resolved.url);
}

/** Absolute share-card URL for an event or DJ, served by the API. */
export const shareImage = (apiUrl, kind, id) => `${apiUrl}/site/share/${kind}/${id}`;

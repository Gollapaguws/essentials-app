/**
 * Geographic helpers shared by route planning and invoice travel.
 *
 * Address lookups use OpenStreetMap's Nominatim search endpoint. It needs no key
 * but asks for an identifying User-Agent, at most one request per second, and
 * that results are cached. The DJ's coordinates are stored on the profile, so a
 * saved home base is never looked up again.
 */
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "ESSENTIALS/1.0 (https://essentialsedm.com; hello@essentialsedm.com)";
const MIN_INTERVAL_MS = 1100;

let lastGeocodeAt = 0;
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

/** Haversine distance in km, to one decimal place. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371,
    toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat),
    dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return +(2 * R * Math.asin(Math.sqrt(h))).toFixed(1);
}

/**
 * Turn a street address into coordinates. Returns null when the address cannot
 * be found or the lookup service is unavailable; callers decide whether that is
 * a validation error or a reason to skip a travel charge.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const query = address.trim().replace(/\s+/g, " ");
  if (!query) return null;
  const key = query.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  // Keep the whole process under Nominatim's one-request-per-second limit.
  const wait = MIN_INTERVAL_MS - (Date.now() - lastGeocodeAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastGeocodeAt = Date.now();

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "za");
  url.searchParams.set("email", "hello@essentialsedm.com");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat?: string; lon?: string }[];
    const lat = Number(rows[0]?.lat);
    const lng = Number(rows[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      geocodeCache.set(key, null);
      return null;
    }
    const found = { lat, lng };
    geocodeCache.set(key, found);
    return found;
  } catch {
    return null;
  }
}

/**
 * What a DJ can bill a venue for travel: home base to the gig and back, at the
 * platform rate. Null when either end has no coordinates, so the caller can ask
 * for the missing home base instead of silently billing zero.
 */
export function homeTravel(
  home: { homeLat: number | null; homeLng: number | null; travelRatePerKm: number },
  venue: { lat: number | null; lng: number | null } | null | undefined,
) {
  if (home.homeLat == null || home.homeLng == null || venue?.lat == null || venue?.lng == null) {
    return null;
  }
  const distanceKm = +(haversineKm({ lat: home.homeLat, lng: home.homeLng }, { lat: venue.lat, lng: venue.lng }) * 2).toFixed(1);
  return { distanceKm, fee: Math.round(distanceKm * home.travelRatePerKm) };
}

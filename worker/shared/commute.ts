export interface LatLon {
  lat: number;
  lon: number;
}

// University of Twente campus (Drienerlolaan, Enschede)
export const CAMPUS: LatLon = { lat: 52.2435, lon: 6.8519 };

const NOMINATIM_URL =
  process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const OSRM_URL =
  process.env.OSRM_URL || "https://router.project-osrm.org/route/v1";

/**
 * Geocode a free-text address via Nominatim (OpenStreetMap). Returns null on
 * any failure so callers can degrade gracefully.
 */
export async function geocode(query: string): Promise<LatLon | null> {
  try {
    const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "KamerCatch/1.0 (personal housing radar)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

/**
 * Bike routing via OSRM. Returns duration in minutes, or null on failure.
 */
export async function bikeMinutes(
  from: LatLon,
  to: LatLon = CAMPUS,
): Promise<number | null> {
  try {
    const url = `${OSRM_URL}/bike/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      code: string;
      routes: Array<{ duration: number }>;
    };
    if (data.code !== "Ok" || !data.routes?.length) return null;
    return Math.round(data.routes[0].duration / 60);
  } catch {
    return null;
  }
}

/**
 * One-shot helper: geocode a location string and return bike minutes to campus.
 */
export async function commuteMinutesToCampus(
  location: string,
): Promise<number | null> {
  const coords = await geocode(location);
  if (!coords) return null;
  return bikeMinutes(coords);
}

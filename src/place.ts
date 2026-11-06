// A readable launch-site name, such as "Gerlach, Nevada", from the pad's GPS fix.
//
// From OpenStreetMap's Nominatim reverse geocoder rather than Google's: Google's
// Maps terms forbid keeping its geocoding results, and the point here is to work
// the name out once per flight and keep it (on the CSV's custom metadata, key
// `place`) so the flight list can show it without loading every file. Nominatim
// allows that, with attribution, and asks for at most one request a second,
// which one lookup per opened flight is far below.
// https://operations.osmfoundation.org/policies/nominatim/

export const PLACE_ATTRIBUTION = 'Place names © OpenStreetMap contributors';

interface NominatimAddress {
  hamlet?: string; village?: string; town?: string; city?: string; municipality?: string;
  suburb?: string; county?: string; state?: string; region?: string;
  country?: string; country_code?: string;
}

/** "Town, State" in the US, "Town, Region, Country" elsewhere; undefined if nothing usable. */
export function formatPlace(a: NominatimAddress | undefined): string | undefined {
  if (!a) return undefined;
  const local = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.suburb ?? a.county;
  const region = a.state ?? a.region;
  const parts = [local, region];
  if (a.country_code && a.country_code.toLowerCase() !== 'us') parts.push(a.country);
  const out = parts.filter((p): p is string => Boolean(p && p.trim())).map((p) => p.trim());
  // Drop a repeat, such as a city-state named like its state.
  const unique = out.filter((p, i) => out.indexOf(p) === i);
  return unique.length ? unique.join(', ').slice(0, 100) : undefined;
}

/** The place name for a point, or undefined when the lookup fails or finds nothing. */
export async function lookupPlace(lat: number, lon: number): Promise<string | undefined> {
  const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en' +
    `&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return undefined;
    const j = await res.json() as { address?: NominatimAddress };
    return formatPlace(j.address);
  } catch {
    return undefined;
  }
}

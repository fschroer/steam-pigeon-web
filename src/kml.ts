// The flight path as KML, for Google Earth (web, desktop or mobile: File -> Import,
// or open the file). Built from the stored CSV like everything else on the web,
// so it carries no copy of the wire format (ADR-0042 decision 4).
//
// Positions: lat_deg/lon_deg where the GPS had a fix (fix_type >= 2) and the pair is
// not 0,0. The CSV repeats the last fix at the loop rate, so consecutive duplicates
// are dropped. Altitude: fused_agl_m, relative to the ground under each point —
// what the locator measured, not the GPS altitude, which the CSV does not carry.
//
// Extent, matching the app's map (system summary "Where the drawn flight path
// stops"): from the last pad fix before launch to the locator's first fix after
// Landed. A record runs on after landing, so without this the path also drew the
// walk back to the pad, and a simulated flight's jump back to the real position.
// The app drops a simulated flight's landing fix by its sim flag; the CSV has no
// such flag, so here the landing fix is kept only if reaching it from the last
// descent fix needs no more than LANDING_MAX_SPEED_MPS (plus GPS slack). A real
// fix after a radio dropout passes; a jump of hundreds of meters in a tenth of
// a second does not.

import { column, type FlightTable } from './csv';
import { flightStateName } from './channels';

export interface PathPoint {
  t: number;
  lat: number;
  lon: number;
  agl: number;
}

const LANDED = 8;
const LANDING_MAX_SPEED_MPS = 50;
const LANDING_SLACK_M = 30;
const M_PER_DEG_LAT = 111_320;

/** Ground distance in meters, flat-earth: plenty for points a few km apart. */
export function groundDistanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLon = (b.lon - a.lon) * M_PER_DEG_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * The height above ground to draw: fused_agl_m, unless the record has no real
 * fused solution. Older exports, and records whose fusion never ran, carry the
 * column as blanks or as 0.00 (the export prints a NaN as 0.00), and drawing
 * that would flatten the flight onto the ground. Then raw_baro_agl_m is used.
 */
export function heightColumn(table: FlightTable): (number | null)[] | undefined {
  const fused = column(table, 'fused_agl_m');
  const raw = column(table, 'raw_baro_agl_m');
  const peak = (c?: (number | null)[]) => (c ?? []).reduce<number>((m, v) => (v !== null && v > m ? v : m), 0);
  if (fused && peak(fused) >= 1) return fused;
  if (raw && peak(raw) >= 1) return raw;
  return fused ?? raw;
}

export function flightPath(table: FlightTable): PathPoint[] {
  const time = column(table, 'time_ms');
  const lat = column(table, 'lat_deg');
  const lon = column(table, 'lon_deg');
  const agl = heightColumn(table);
  const fix = column(table, 'fix_type');
  const state = column(table, 'flight_state');
  if (!time || !lat || !lon || !agl) return [];

  const fixAt = (i: number): PathPoint | null => {
    const la = lat[i], lo = lon[i], t = time[i];
    if (la === null || lo === null || t === null) return null;
    if (la === 0 && lo === 0) return null;
    if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
    const f = fix?.[i];
    if (fix && (f === null || f === undefined || f < 2)) return null;
    return { t: t / 1000, lat: la, lon: lo, agl: Math.max(0, agl[i] ?? 0) };
  };
  const same = (a: PathPoint | undefined, b: PathPoint) => a !== undefined && a.lat === b.lat && a.lon === b.lon;

  const launch = state ? state.findIndex((s) => s !== null && s >= 1) : -1;
  const out: PathPoint[] = [];

  // No launch in the record (a pad-only record): show what there is.
  if (launch < 0) {
    for (let i = 0; i < table.rows; i++) {
      const p = fixAt(i);
      if (p && !same(out[out.length - 1], p)) out.push(p);
    }
    return out;
  }

  // The last pad fix before launch, so the path starts on the pad.
  for (let i = launch - 1; i >= 0; i--) {
    const p = fixAt(i);
    if (p) { out.push(p); break; }
  }
  let i = launch;
  for (; i < table.rows; i++) {
    if (state![i] === LANDED) break;
    const p = fixAt(i);
    if (p && !same(out[out.length - 1], p)) out.push(p);
  }
  // The locator's first new fix after Landed, if it is physically reachable.
  for (; i < table.rows; i++) {
    const p = fixAt(i);
    if (!p) continue;
    const last = out[out.length - 1];
    if (same(last, p)) continue;
    if (!last || groundDistanceM(last, p) <= LANDING_MAX_SPEED_MPS * (p.t - last.t) + LANDING_SLACK_M) out.push(p);
    break;
  }
  return out;
}

export interface PathEvent {
  t: number;
  state: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function coord(p: PathPoint): string {
  return `${p.lon},${p.lat},${p.agl.toFixed(1)}`;
}

/** The point nearest in time to [t], or undefined for an empty path. */
function nearest(path: PathPoint[], t: number): PathPoint | undefined {
  let best: PathPoint | undefined;
  for (const p of path) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}

export interface Orbit {
  lat: number;
  lon: number;
  /** Height above ground the camera aims at, m. */
  alt: number;
  /** Camera distance from that point, m. */
  range: number;
}

const M_PER_DEG = 111_320;

/** Where the opening view aims and how far back it stands, so the whole flight is in frame. */
export function orbitFor(path: PathPoint[]): Orbit | undefined {
  if (!path.length) return undefined;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity, top = 0;
  for (const p of path) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    top = Math.max(top, p.agl);
  }
  const lat = (minLat + maxLat) / 2;
  const lon = (minLon + maxLon) / 2;
  const ns = (maxLat - minLat) * M_PER_DEG;
  const ew = (maxLon - minLon) * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const span = Math.max(Math.hypot(ns, ew), top);
  return { lat, lon, alt: top / 2, range: Math.max(300, span * 1.8) };
}

/** The opening view looks at the flight from the south, tilted 70 degrees from straight down. */
const VIEW_TILT = 70;

function lookAt(o: Orbit, heading: number): string {
  return `<LookAt><longitude>${o.lon.toFixed(7)}</longitude><latitude>${o.lat.toFixed(7)}</latitude>` +
    `<altitude>${o.alt.toFixed(1)}</altitude><heading>${heading.toFixed(1)}</heading>` +
    `<tilt>${VIEW_TILT}</tilt><range>${o.range.toFixed(0)}</range>` +
    `<altitudeMode>relativeToGround</altitudeMode></LookAt>`;
}

/**
 * The flight as KML. Plain KML only: Google Earth on the web refuses a file with
 * gx: extensions (a fly-around gx:Tour was tried and withdrawn, 2026-11-05). The
 * same angled LookAt sits on the Document and on the path's Placemark: Earth Pro
 * opens on the Document's, and Earth on the web flies to a feature's view when it
 * is selected in the project list.
 */
export function buildKml(name: string, path: PathPoint[], events: PathEvent[]): string {
  const view = orbitFor(path);
  const placemarks = events.map((e) => {
    const p = nearest(path, e.t);
    if (!p) return '';
    return `    <Placemark>
      <name>${esc(flightStateName(e.state))}</name>
      <description>${e.t.toFixed(2)} s, ${p.agl.toFixed(0)} m AGL</description>
      <styleUrl>#event</styleUrl>
      <Point><altitudeMode>relativeToGround</altitudeMode><coordinates>${coord(p)}</coordinates></Point>
    </Placemark>`;
  }).filter(Boolean).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(name)}</name>
    <open>1</open>${view ? `\n    ${lookAt(view, 0)}` : ''}
    <Style id="path">
      <LineStyle><color>ff0066ff</color><width>3</width></LineStyle>
      <PolyStyle><color>400066ff</color></PolyStyle>
    </Style>
    <Style id="event">
      <IconStyle><scale>0.8</scale></IconStyle>
      <LabelStyle><scale>0.8</scale></LabelStyle>
    </Style>
    <Placemark>
      <name>Flight path</name>${view ? `\n      ${lookAt(view, 0)}` : ''}
      <styleUrl>#path</styleUrl>
      <LineString>
        <extrude>1</extrude>
        <tessellate>0</tessellate>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>
${path.map((p) => `          ${coord(p)}`).join('\n')}
        </coordinates>
      </LineString>
    </Placemark>
${placemarks}
  </Document>
</kml>
`;
}

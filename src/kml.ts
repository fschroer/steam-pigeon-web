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

export function flightPath(table: FlightTable): PathPoint[] {
  const time = column(table, 'time_ms');
  const lat = column(table, 'lat_deg');
  const lon = column(table, 'lon_deg');
  const agl = column(table, 'fused_agl_m');
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

/**
 * The flight as KML. Plain KML only: Google Earth on the web refuses a file with
 * gx: extensions (a fly-around gx:Tour was tried and withdrawn, 2026-11-05), and
 * no camera is set, so Earth frames the path itself.
 */
export function buildKml(name: string, path: PathPoint[], events: PathEvent[]): string {
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
    <Style id="path">
      <LineStyle><color>ffd6782a</color><width>3</width></LineStyle>
      <PolyStyle><color>40d6782a</color></PolyStyle>
    </Style>
    <Style id="event">
      <IconStyle><scale>0.8</scale></IconStyle>
      <LabelStyle><scale>0.8</scale></LabelStyle>
    </Style>
    <Placemark>
      <name>Flight path</name>
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

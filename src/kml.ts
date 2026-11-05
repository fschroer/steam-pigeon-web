// The flight path as KML, for Google Earth (web, desktop or mobile: File -> Import,
// or open the file). Built from the stored CSV like everything else on the web,
// so it carries no copy of the wire format (ADR-0042 decision 4).
//
// Positions: lat_deg/lon_deg where the GPS had a fix (fix_type >= 2) and the pair is
// not 0,0. The CSV repeats the last fix at the loop rate, so consecutive duplicates
// are dropped. Altitude: fused_agl_m, relative to the ground under each point —
// what the locator measured, not the GPS altitude, which the CSV does not carry.

import { column, type FlightTable } from './csv';
import { flightStateName } from './channels';

export interface PathPoint {
  t: number;
  lat: number;
  lon: number;
  agl: number;
}

export function flightPath(table: FlightTable): PathPoint[] {
  const time = column(table, 'time_ms');
  const lat = column(table, 'lat_deg');
  const lon = column(table, 'lon_deg');
  const agl = column(table, 'fused_agl_m');
  const fix = column(table, 'fix_type');
  if (!time || !lat || !lon || !agl) return [];
  const out: PathPoint[] = [];
  for (let i = 0; i < table.rows; i++) {
    const la = lat[i], lo = lon[i], t = time[i];
    if (la === null || lo === null || t === null) continue;
    if (la === 0 && lo === 0) continue;
    if (Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
    const f = fix?.[i];
    if (fix && (f === null || f === undefined || f < 2)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.lat === la && prev.lon === lo) continue;
    out.push({ t: t / 1000, lat: la, lon: lo, agl: Math.max(0, agl[i] ?? 0) });
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

/** Where a fly-around aims and how far out it circles, so the whole flight stays in frame. */
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

/** Fly-around timing: one full circle in this many steps and seconds. */
export const ORBIT_STEPS = 36;
export const ORBIT_SECONDS = 40;
const ORBIT_TILT = 70;

function lookAt(o: Orbit, heading: number): string {
  return `<LookAt><longitude>${o.lon.toFixed(7)}</longitude><latitude>${o.lat.toFixed(7)}</latitude>` +
    `<altitude>${o.alt.toFixed(1)}</altitude><heading>${heading.toFixed(1)}</heading>` +
    `<tilt>${ORBIT_TILT}</tilt><range>${o.range.toFixed(0)}</range>` +
    `<altitudeMode>relativeToGround</altitudeMode></LookAt>`;
}

/**
 * A gx:Tour that circles the flight once, always pointing at its center.
 * Google Earth Pro plays it from the Places panel (double-click "Fly around").
 * Google Earth on the web refuses the whole file ("Unsupported element: gx:Tour",
 * seen 2026-11-05), so the tour goes only in its own file (buildKml tour: true).
 */
function tour(o: Orbit): string {
  const step = ORBIT_SECONDS / ORBIT_STEPS;
  const legs = [];
  for (let i = 1; i <= ORBIT_STEPS; i++) {
    legs.push(`          <gx:FlyTo><gx:duration>${step.toFixed(2)}</gx:duration><gx:flyToMode>smooth</gx:flyToMode>${lookAt(o, (i * 360) / ORBIT_STEPS)}</gx:FlyTo>`);
  }
  return `    <gx:Tour>
      <name>Fly around</name>
      <gx:Playlist>
          <gx:FlyTo><gx:duration>3</gx:duration><gx:flyToMode>bounce</gx:flyToMode>${lookAt(o, 0)}</gx:FlyTo>
${legs.join('\n')}
      </gx:Playlist>
    </gx:Tour>`;
}

/**
 * The flight as KML. With [opts.tour] the file also carries the fly-around, for
 * Google Earth Pro only; without it the file opens anywhere, Earth on the web included.
 */
export function buildKml(name: string, path: PathPoint[], events: PathEvent[], opts: { tour?: boolean } = {}): string {
  const orbit = orbitFor(path);
  const withTour = Boolean(opts.tour && orbit);
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
<kml xmlns="http://www.opengis.net/kml/2.2"${withTour ? ' xmlns:gx="http://www.google.com/kml/ext/2.2"' : ''}>
  <Document>
    <name>${esc(name)}</name>
    <open>1</open>${orbit ? `\n    ${lookAt(orbit, 0)}` : ''}
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
${withTour && orbit ? tour(orbit) : ''}
  </Document>
</kml>
`;
}

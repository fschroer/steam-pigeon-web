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

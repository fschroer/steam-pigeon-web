// In-page 3D view of the flight on Google's photorealistic 3D map (Maps JavaScript
// API, maps3d library: Map3DElement, Polyline3DElement, Marker3DElement).
// ADR-0042 amendment 2026-11-05: chosen over KML-only because the page controls
// the camera, which Google Earth on the web would not let a KML file do.
//
// Cost: each map load is billed under the "Immersive Maps" SKU (5,000 free loads a
// month as of 2026-11-05). So the map loads only when the viewer asks for it,
// never on opening a flight page.
//
// Heights: the path and pins use RELATIVE_TO_GROUND with fused AGL, so they need
// no ground elevation. The camera's center altitude is absolute (MSL), and the CSV
// has no GPS altitude, so the pad's height is estimated from the baro pressure on
// the pad (standard atmosphere). Weather moves that by tens of meters, which only
// nudges where the camera aims. Older exports carry no pressure column. Then the
// camera aims relative to the ground (CameraOptions.altitudeMode), which only the
// fly animations accept, so the map opens and at once flies to that view. Aiming
// at sea level instead put the target hundreds of meters underground at a high
// site (Black Rock, about 1,190 m) and cut off the top of the flight.

import { altitudeText, currentUnits, type Units } from './units';
import { column, type FlightTable } from './csv';
import { orbitFor, type PathPoint, type PathEvent } from './kml';
import { flightStateName } from './channels';

export const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';

/** Standard-atmosphere altitude, m, for a pressure in Pa. */
export function pressureAltitudeM(pa: number): number {
  return 44330 * (1 - Math.pow(pa / 101325, 0.190295));
}

/**
 * The pad's height above sea level from the median baro pressure before launch,
 * or undefined when the record has none.
 */
export function padElevationM(table: FlightTable): number | undefined {
  const p = column(table, 'baro_raw_pressure_pa');
  const s = column(table, 'flight_state');
  if (!p) return undefined;
  const pad: number[] = [];
  for (let i = 0; i < table.rows; i++) {
    const v = p[i];
    if (v === null || v < 30_000 || v > 110_000) continue;
    if (s && s[i] !== null && s[i]! >= 1) break;
    pad.push(v);
  }
  if (!pad.length) return undefined;
  pad.sort((a, b) => a - b);
  return pressureAltitudeM(pad[Math.floor(pad.length / 2)]);
}

export interface Camera3D {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
  /**
   * RELATIVE_TO_GROUND when the pad's sea-level height is unknown: center.altitude
   * is then above the ground. Map3DElement's own center is always above sea level,
   * so such a camera is reached with flyCameraTo.
   */
  altitudeMode?: 'RELATIVE_TO_GROUND';
}

/** The app's flight-path color (MapLibreCompat COLOR_PATH), so both draw the same orange. */
export const PATH_COLOR = '#ff6600';

const TILT = 67.5;
/** Map3DElement's default field of view, degrees; taken as horizontal. */
const FOV = 35;
/** Room around the flight for the pins and their labels. */
const MARGIN = 1.35;

/**
 * The angled opening view: the whole flight in frame, from the south.
 * [aspect] is the map's height / width. The camera stands back far enough for
 * both the flight's height and its ground track to fit, with a margin for the
 * event pins' labels, which sit above the highest points.
 */
export function flightCamera(path: PathPoint[], padMslM: number | undefined, aspect = 0.5): Camera3D | undefined {
  const o = orbitFor(path);
  if (!o) return undefined;
  let top = 0;
  for (const p of path) top = Math.max(top, p.agl);
  const hHalf = (FOV / 2) * (Math.PI / 180);
  const vHalf = Math.atan(Math.tan(hHalf) * aspect);
  // Seen from 67.5 degrees of tilt the vertical spans almost its full height
  // across the screen (sin of the tilt); the ground track is foreshortened.
  const tiltRad = (TILT * Math.PI) / 180;
  const needV = ((top / 2) * Math.sin(tiltRad) * MARGIN) / Math.tan(vHalf);
  const ground = o.range / 1.8;            // orbitFor's span, before its own factor
  const needH = ((ground / 2) * MARGIN) / Math.tan(hHalf);
  return {
    center: { lat: o.lat, lng: o.lon, altitude: (padMslM ?? 0) + o.alt },
    range: Math.max(300, needV, needH),
    tilt: TILT,
    heading: 0,
    ...(padMslM === undefined ? { altitudeMode: 'RELATIVE_TO_GROUND' as const } : {}),
  };
}

/**
 * Path points that answer the pointer: Google's 3D map fires no hover events on
 * the map or a polyline, but Marker3DInteractiveElement fires gmp-pointerover.
 * So small markers sit along the line, at least [minGapS] apart and at most
 * [max] of them, the last point always included.
 */
export function hoverPoints(path: PathPoint[], minGapS = 0.1, max = 2500): PathPoint[] {
  if (!path.length) return [];
  const span = path[path.length - 1].t - path[0].t;
  const gap = Math.max(minGapS, span / Math.max(1, max - 1));
  const out: PathPoint[] = [];
  for (const p of path) {
    if (!out.length || p.t - out[out.length - 1].t >= gap) out.push(p);
  }
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) {
    if (out.length >= max) out[out.length - 1] = last; else out.push(last);
  }
  return out;
}

/** The text the 3D view shows for a path point under the pointer. */
export function readoutText(p: PathPoint, units: Units = 'metric'): string {
  return `${p.t.toFixed(1)} s · ${altitudeText(p.agl, units)} AGL`;
}

/** A hover point's dot: the path's solid orange, about the line's width, so it blends in. */
export const HOVER_DOT_PX = 5;
export function hoverDotSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5" viewBox="0 0 5 5">' +
    '<circle cx="2.5" cy="2.5" r="2.5" fill="#ff6600"/></svg>';
}

/** The event pin: a small orange-ringed dot, in place of the default red map pin. */
export function eventIconSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
    '<circle cx="9" cy="9" r="6.5" fill="#ffffff" stroke="#ff6600" stroke-width="3"/></svg>';
}

// ---- loading the Maps JavaScript API ----------------------------------------------------

type Maps3d = Record<string, any>;   // the library ships no TypeScript types we depend on
let loading: Promise<Maps3d> | null = null;

/** Google's dynamic library loader, reduced to what this page needs. */
function loadMaps3d(key: string): Promise<Maps3d> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as unknown as { google?: any; __spMapsReady?: () => void };
    w.__spMapsReady = () => {
      w.google.maps.importLibrary('maps3d').then(resolve, reject);
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      '&v=beta&libraries=maps3d&loading=async&callback=__spMapsReady';
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error('could not load the Google Maps script')); };
    document.head.append(s);
  });
  return loading;
}

export interface Flight3D {
  map: HTMLElement;
  flyAround(): void;
  /** Stops a fly-around or fly-to in progress. */
  stop(): void;
  resetView(): void;
}

/** Builds the 3D map into [host]: the path, a pin per flight event, and the angled view. */
export async function showFlight3D(host: HTMLElement, path: PathPoint[], events: PathEvent[], camera: Camera3D): Promise<Flight3D> {
  const lib = await loadMaps3d(MAPS_KEY);
  const { Map3DElement, Polyline3DElement, Marker3DElement, Marker3DInteractiveElement } = lib;

  const { altitudeMode, ...opening } = camera;
  const map = new Map3DElement({ ...opening, mode: 'SATELLITE' });
  map.style.width = '100%';
  map.style.height = '100%';

  const line = new Polyline3DElement({
    altitudeMode: 'RELATIVE_TO_GROUND',
    strokeColor: PATH_COLOR,
    strokeWidth: 4,
    outerColor: '#ffffff',
    outerWidth: 0.3,
    drawsOccludedSegments: true,
  });
  line.path = path.map((p) => ({ lat: p.lat, lng: p.lon, altitude: p.agl }));
  map.append(line);

  // Time and height under the pointer, read off small markers along the line.
  const readout = document.createElement('div');
  readout.className = 'map3d-readout';
  readout.hidden = true;
  if (Marker3DInteractiveElement) {
    const dot = `data:image/svg+xml;utf8,${encodeURIComponent(hoverDotSvg())}`;
    for (const p of hoverPoints(path)) {
      const m = new Marker3DInteractiveElement({
        position: { lat: p.lat, lng: p.lon, altitude: p.agl },
        altitudeMode: 'RELATIVE_TO_GROUND',
        sizePreserved: true,
      });
      const tpl = document.createElement('template');
      const img = document.createElement('img');
      img.src = dot; img.width = HOVER_DOT_PX; img.height = HOVER_DOT_PX;
      tpl.content.append(img);
      m.append(tpl);
      m.addEventListener('gmp-pointerover', () => { readout.textContent = readoutText(p, currentUnits()); readout.hidden = false; });
      m.addEventListener('gmp-pointerout', () => { readout.hidden = true; });
      m.addEventListener('gmp-click', () => { readout.textContent = readoutText(p, currentUnits()); readout.hidden = false; });
      map.append(m);
    }
  }

  for (const e of events) {
    let best: PathPoint | undefined;
    for (const p of path) if (!best || Math.abs(p.t - e.t) < Math.abs(best.t - e.t)) best = p;
    if (!best) continue;
    // No extrusion: Frank asked for the white lines down to the ground to go.
    const marker = new Marker3DElement({
      position: { lat: best.lat, lng: best.lon, altitude: best.agl },
      altitudeMode: 'RELATIVE_TO_GROUND',
      label: flightStateName(e.state),
      sizePreserved: true,
    });
    const icon = document.createElement('template');
    const img = document.createElement('img');
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(eventIconSvg())}`;
    img.width = 18; img.height = 18;
    icon.content.append(img);
    marker.append(icon);
    map.append(marker);
  }

  map.addEventListener('gmp-error', () => { /* surfaced by the caller's timeout text */ });
  // Any click on the map stops a fly-around, so the viewer can take over.
  map.addEventListener('gmp-click', () => map.stopCameraAnimation?.());

  host.replaceChildren(map, readout);
  // A ground-relative camera can only be reached by flying to it.
  if (altitudeMode) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      map.flyCameraTo({ endCamera: camera, durationMillis: 800 });
    };
    map.addEventListener('gmp-steadychange', go);
    setTimeout(go, 2_000);   // in case the steady event never comes
  }
  return {
    map,
    stop: () => map.stopCameraAnimation?.(),
    flyAround: () => map.flyCameraAround({ camera, durationMillis: 30_000, repeatCount: 1 }),
    resetView: () => map.flyCameraTo({ endCamera: camera, durationMillis: 1_500 }),
  };
}

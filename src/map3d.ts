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
// nudges where the camera aims.

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
}

/** The angled opening view: the whole flight in frame, from the south, 67.5 degrees of tilt. */
export function flightCamera(path: PathPoint[], padMslM: number | undefined): Camera3D | undefined {
  const o = orbitFor(path);
  if (!o) return undefined;
  return {
    center: { lat: o.lat, lng: o.lon, altitude: (padMslM ?? 0) + o.alt },
    range: o.range,
    tilt: 67.5,
    heading: 0,
  };
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
  resetView(): void;
}

/** Builds the 3D map into [host]: the path, a pin per flight event, and the angled view. */
export async function showFlight3D(host: HTMLElement, path: PathPoint[], events: PathEvent[], camera: Camera3D, pathColor: string): Promise<Flight3D> {
  const lib = await loadMaps3d(MAPS_KEY);
  const { Map3DElement, Polyline3DElement, Marker3DElement } = lib;

  const map = new Map3DElement({ ...camera, mode: 'SATELLITE' });
  map.style.width = '100%';
  map.style.height = '100%';

  const line = new Polyline3DElement({
    altitudeMode: 'RELATIVE_TO_GROUND',
    strokeColor: pathColor,
    strokeWidth: 4,
    outerColor: '#ffffff',
    outerWidth: 0.3,
    drawsOccludedSegments: true,
  });
  line.path = path.map((p) => ({ lat: p.lat, lng: p.lon, altitude: p.agl }));
  map.append(line);

  for (const e of events) {
    let best: PathPoint | undefined;
    for (const p of path) if (!best || Math.abs(p.t - e.t) < Math.abs(best.t - e.t)) best = p;
    if (!best) continue;
    map.append(new Marker3DElement({
      position: { lat: best.lat, lng: best.lon, altitude: best.agl },
      altitudeMode: 'RELATIVE_TO_GROUND',
      extruded: true,
      label: flightStateName(e.state),
    }));
  }

  map.addEventListener('gmp-error', () => { /* surfaced by the caller's timeout text */ });
  // Any click on the map stops a fly-around, so the viewer can take over.
  map.addEventListener('gmp-click', () => map.stopCameraAnimation?.());

  host.replaceChildren(map);
  return {
    map,
    flyAround: () => map.flyCameraAround({ camera, durationMillis: 30_000, repeatCount: 1 }),
    resetView: () => map.flyCameraTo({ endCamera: camera, durationMillis: 1_500 }),
  };
}

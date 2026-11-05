import { describe, expect, it } from 'vitest';
import { pressureAltitudeM, padElevationM, flightCamera, hoverPoints, readoutText } from '../src/map3d';
import type { FlightTable } from '../src/csv';

function table(cols: Record<string, (number | null)[]>): FlightTable {
  const columns = Object.keys(cols);
  return { columns, data: columns.map((c) => cols[c]), rows: cols[columns[0]].length };
}

describe('pad elevation from baro pressure', () => {
  it('follows the standard atmosphere', () => {
    expect(pressureAltitudeM(101325)).toBeCloseTo(0, 6);
    expect(pressureAltitudeM(89874.6)).toBeCloseTo(1000, -1);   // ISA at 1,000 m
  });

  it('uses the median pad pressure and ignores flight and blank samples', () => {
    const t = table({
      baro_raw_pressure_pa: [89870, null, 89880, 89875, 85000, 80000],
      flight_state:         [0,     0,    0,     0,     1,     3],
    });
    expect(padElevationM(t)).toBeCloseTo(pressureAltitudeM(89875), 6);
  });

  it('is undefined without pressure', () => {
    expect(padElevationM(table({ flight_state: [0, 1] }))).toBeUndefined();
  });
});

describe('flightCamera', () => {
  const path = [
    { t: 0, lat: 37.0, lon: -122.0, agl: 0 },
    { t: 10, lat: 37.001, lon: -122.0, agl: 600 },
    { t: 60, lat: 37.002, lon: -121.998, agl: 0 },
  ];

  it('aims at half apogee above the pad, angled from the south', () => {
    const c = flightCamera(path, 1000)!;
    expect(c.center.altitude).toBe(1300);
    expect(c.tilt).toBe(67.5);
    expect(c.heading).toBe(0);
  });

  it('stands back far enough that the top of the flight, plus a margin, is in frame', () => {
    for (const aspect of [0.3, 0.5, 1]) {
      const c = flightCamera(path, 0, aspect)!;
      const vHalf = Math.atan(Math.tan((17.5 * Math.PI) / 180) * aspect);
      const visibleHalfHeight = c.range * Math.tan(vHalf);
      // The apogee sits 300 m above the aim point; seen at 67.5 degrees tilt.
      expect(visibleHalfHeight).toBeGreaterThanOrEqual(300 * Math.sin((67.5 * Math.PI) / 180) * 1.3);
    }
    // A wider map needs a longer range for the same height.
    expect(flightCamera(path, 0, 0.3)!.range).toBeGreaterThan(flightCamera(path, 0, 1)!.range);
  });

  it('aims relative to the ground when the pad height is unknown', () => {
    const c = flightCamera(path, undefined)!;
    expect(c.center.altitude).toBe(300);
    expect(c.altitudeMode).toBe('RELATIVE_TO_GROUND');
    expect(flightCamera(path, 1000)!.altitudeMode).toBeUndefined();
  });
});

describe('hoverPoints', () => {
  const pts = (n: number, dt: number) =>
    Array.from({ length: n }, (_, i) => ({ t: i * dt, lat: 37, lon: -122, agl: i }));

  it('spaces points at least a second apart and keeps the last', () => {
    const h = hoverPoints(pts(101, 0.1));          // 10 s at 10 Hz
    expect(h.map((p) => p.t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => expect.closeTo(v, 6)));
  });

  it('caps the count on a long flight', () => {
    const h = hoverPoints(pts(5000, 0.1), 1, 100);  // 500 s
    expect(h.length).toBeLessThanOrEqual(100);
    expect(h[h.length - 1].t).toBeCloseTo(499.9);
  });

  it('reads out time and height', () => {
    expect(readoutText({ t: 12.345, lat: 0, lon: 0, agl: 845.4 })).toBe('12.3 s · 845 m AGL');
  });
});

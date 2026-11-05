import { describe, expect, it } from 'vitest';
import { pressureAltitudeM, padElevationM, flightCamera } from '../src/map3d';
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
    expect(c.range).toBeGreaterThanOrEqual(600 * 1.8);
  });

  it('falls back to sea level for the pad', () => {
    expect(flightCamera(path, undefined)!.center.altitude).toBe(300);
  });
});

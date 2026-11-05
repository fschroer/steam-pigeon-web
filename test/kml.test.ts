import { describe, expect, it } from 'vitest';
import { flightPath, buildKml } from '../src/kml';
import type { FlightTable } from '../src/csv';

function table(cols: Record<string, (number | null)[]>): FlightTable {
  const columns = Object.keys(cols);
  return { columns, data: columns.map((c) => cols[c]), rows: cols[columns[0]].length };
}

describe('flightPath', () => {
  it('keeps fixed positions, drops repeats, no-fix rows and 0,0', () => {
    const t = table({
      time_ms:     [0,        20,       40,       60,       80,       100],
      lat_deg:     [0,        37.1,     37.1,     37.2,     37.3,     null],
      lon_deg:     [0,        -122.1,   -122.1,   -122.2,   -122.3,   -122.4],
      fused_agl_m: [0,        1,        2,        -0.4,     100,      120],
      fix_type:    [3,        3,        3,        3,        1,        3],
    });
    expect(flightPath(t)).toEqual([
      { t: 0.02, lat: 37.1, lon: -122.1, agl: 1 },
      { t: 0.06, lat: 37.2, lon: -122.2, agl: 0 },
    ]);
  });

  it('is empty without position columns', () => {
    expect(flightPath(table({ time_ms: [0, 1] }))).toEqual([]);
  });

  // ~0.001 deg of latitude is 111 m.
  const flight = (landedLat: number, landedT: number) => table({
    time_ms:      [0,     1000,  2000,  3000,   4000,   5000,  landedT,   99000],
    lat_deg:      [37.0,  37.0,  37.0,  37.001, 37.002, 37.003, landedLat, 37.0],
    lon_deg:      [-122,  -122,  -122,  -122,   -122,   -122,  -122,      -122],
    fused_agl_m:  [0,     0,     50,    300,    100,    5,     0,         0],
    fix_type:     [3,     3,     3,     3,      3,      3,     3,         3],
    flight_state: [0,     0,     1,     3,      4,      6,     8,         8],
  });

  it('runs from the pad to the first fix after Landed, not the walk back', () => {
    const p = flightPath(flight(37.0031, 6000));
    expect(p.map((x) => x.lat)).toEqual([37.0, 37.001, 37.002, 37.003, 37.0031]);
  });

  it('drops a landing fix no rocket could reach (a simulated flight snapping home)', () => {
    // 333 m back to the pad in 0.1 s.
    const p = flightPath(flight(37.0, 5100));
    expect(p.map((x) => x.lat)).toEqual([37.0, 37.001, 37.002, 37.003]);
  });

  it('keeps a distant landing fix after a long dropout', () => {
    // 333 m in 60 s is 5.6 m/s.
    const p = flightPath(flight(37.006, 65000));
    expect(p[p.length - 1].lat).toBe(37.006);
  });
});

describe('buildKml', () => {
  const path = [
    { t: 0, lat: 37.1, lon: -122.1, agl: 0 },
    { t: 10, lat: 37.2, lon: -122.2, agl: 600.04 },
  ];

  it('writes lon,lat,agl relative to the ground, and escapes the name', () => {
    const kml = buildKml('A & B <test>', path, []);
    expect(kml).toContain('<name>A &amp; B &lt;test&gt;</name>');
    expect(kml).toContain('-122.1,37.1,0.0');
    expect(kml).toContain('-122.2,37.2,600.0');
    expect(kml).toContain('<altitudeMode>relativeToGround</altitudeMode>');
  });

  it('pins each event at the nearest point in time', () => {
    const kml = buildKml('x', path, [{ t: 9, state: 3 }]);
    expect(kml).toContain('<name>Nose-over</name>');
    expect(kml).toMatch(/Nose-over[\s\S]*<coordinates>-122\.2,37\.2,600\.0<\/coordinates>/);
  });
});

describe('fly-around tour', () => {
  const path = [
    { t: 0, lat: 37.0, lon: -122.0, agl: 0 },
    { t: 10, lat: 37.001, lon: -122.0, agl: 600 },
    { t: 60, lat: 37.002, lon: -121.998, agl: 0 },
  ];

  it('aims at the middle of the flight and stands back far enough to frame it', async () => {
    const { orbitFor } = await import('../src/kml');
    const o = orbitFor(path)!;
    expect(o.lat).toBeCloseTo(37.001, 6);
    expect(o.lon).toBeCloseTo(-121.999, 6);
    expect(o.alt).toBe(300);
    expect(o.range).toBeGreaterThanOrEqual(600 * 1.8);
  });

  it('stays out of the plain file, which Google Earth on the web rejects if it has one', () => {
    const kml = buildKml('x', path, []);
    expect(kml).not.toContain('gx:');
  });

  it('circles once: a heading every 10 degrees, ending back at north', async () => {
    const { ORBIT_STEPS } = await import('../src/kml');
    const kml = buildKml('x', path, [], { tour: true });
    expect(kml).toContain('xmlns:gx="http://www.google.com/kml/ext/2.2"');
    expect(kml).toContain('<name>Fly around</name>');
    const headings = [...kml.matchAll(/<gx:FlyTo>.*?<heading>([\d.]+)<\/heading>/g)].map((m) => Number(m[1]));
    expect(headings.length).toBe(ORBIT_STEPS + 1);
    expect(headings[1]).toBe(10);
    expect(headings[headings.length - 1]).toBe(360);
  });

  it('has no tour without a path', () => {
    expect(buildKml('x', [], [], { tour: true })).not.toContain('gx:Tour');
  });
});

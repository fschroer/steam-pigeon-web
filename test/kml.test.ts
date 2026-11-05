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

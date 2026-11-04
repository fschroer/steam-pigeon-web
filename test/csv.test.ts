import { describe, expect, it } from 'vitest';
import { parseFlightCsv, column, stateChanges } from '../src/csv';
import { PANELS } from '../src/channels';

// The header the app's FullRecordCsv writes (rocket-flight-manager), which is
// the locator USB export's. If it changes, update this copy and PANELS.
const HEADER = 'time_ms,raw_baro_agl_m,fused_agl_m,raw_baro_vel_mps,fused_vspeed_mps,' +
  'accel_x_g,accel_y_g,accel_z_g,gyro_x_dps,gyro_y_dps,gyro_z_dps,lat_deg,lon_deg,' +
  'flight_state,armed,ekf_health,gps_vel_n_mps,gps_vel_e_mps,gps_vel_d_mps,gps_h_acc_m,' +
  'tilt_deg,q_w,q_x,q_y,q_z,fix_type,num_sv,accel_alt_x_g,accel_alt_y_g,accel_alt_z_g,' +
  'accel_source,pps_status,gps_s_acc_mps,baro_raw_pressure_pa,baro_temp_c,mag_x_ut,mag_y_ut,mag_z_ut';

function row(t: number, state: number, agl: string, blanks = false): string {
  const f = HEADER.split(',').map(() => '0');
  f[0] = String(t); f[1] = agl; f[2] = agl; f[13] = String(state);
  f[11] = '37.7749295'; f[12] = '-122.4194155';
  if (blanks) { f[16] = ''; f[17] = ''; f[18] = ''; f[33] = ''; f[34] = ''; }
  return f.join(',');
}

describe('parseFlightCsv', () => {
  it('reads the CRLF export, numbers and blanks', () => {
    const text = [HEADER, row(0, 0, '0.00'), row(20, 1, '1.25', true), row(40, 1, '-0.50'), ''].join('\r\n');
    const t = parseFlightCsv(text);
    expect(t.rows).toBe(3);
    expect(t.columns).toEqual(HEADER.split(','));
    expect(column(t, 'time_ms')).toEqual([0, 20, 40]);
    expect(column(t, 'fused_agl_m')).toEqual([0, 1.25, -0.5]);
    expect(column(t, 'gps_vel_n_mps')).toEqual([0, null, 0]);
    expect(column(t, 'baro_raw_pressure_pa')).toEqual([0, null, 0]);
    expect(column(t, 'lat_deg')![0]).toBe(37.7749295);
  });

  it('rejects an empty file', () => {
    expect(() => parseFlightCsv('')).toThrow();
  });

  it('every charted column exists in the export header', () => {
    const cols = new Set(HEADER.split(','));
    for (const p of PANELS) {
      expect(p.labels.length).toBe(p.columns.length);
      expect(p.columns.length).toBeLessThanOrEqual(8);
      for (const c of p.columns) expect(cols.has(c), c).toBe(true);
    }
  });
});

describe('stateChanges', () => {
  it('marks each transition, not the first sample', () => {
    const time = [0, 0.02, 0.04, 0.06, 0.08];
    const state = [0, 0, 1, 1, 2];
    expect(stateChanges(time, state)).toEqual([{ t: 0.04, state: 1 }, { t: 0.08, state: 2 }]);
  });

  it('skips blank samples without inventing a transition', () => {
    expect(stateChanges([0, 1, 2], [3, null, 3])).toEqual([]);
  });
});

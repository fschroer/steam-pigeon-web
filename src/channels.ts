// How the CSV's columns are charted. Each panel has one unit and one y-axis:
// two measures of different units are two panels, never a dual axis.
// Series colors follow the column (its slot within its panel), so selecting or
// clearing another series never repaints the ones already drawn.

export interface Panel {
  id: string;
  title: string;
  unit: string;
  /** CSV column names, in color-slot order. */
  columns: string[];
  labels: string[];
}

export const PANELS: Panel[] = [
  { id: 'alt', title: 'Altitude above ground', unit: 'm',
    columns: ['fused_agl_m', 'raw_baro_agl_m'], labels: ['Fused', 'Raw baro'] },
  { id: 'vel', title: 'Vertical speed', unit: 'm/s',
    columns: ['fused_vspeed_mps', 'raw_baro_vel_mps', 'gps_vel_d_mps'],
    labels: ['Fused', 'Raw baro', 'GPS down'] },
  { id: 'gpsvel', title: 'GPS ground velocity', unit: 'm/s',
    columns: ['gps_vel_n_mps', 'gps_vel_e_mps', 'gps_s_acc_mps'],
    labels: ['North', 'East', 'Speed accuracy'] },
  { id: 'acc', title: 'Acceleration', unit: 'g',
    columns: ['accel_x_g', 'accel_y_g', 'accel_z_g', 'accel_alt_x_g', 'accel_alt_y_g', 'accel_alt_z_g'],
    labels: ['X', 'Y', 'Z', 'Alt X', 'Alt Y', 'Alt Z'] },
  { id: 'gyro', title: 'Rotation rate', unit: '°/s',
    columns: ['gyro_x_dps', 'gyro_y_dps', 'gyro_z_dps'], labels: ['X', 'Y', 'Z'] },
  { id: 'tilt', title: 'Tilt', unit: '°', columns: ['tilt_deg'], labels: ['Tilt'] },
  { id: 'quat', title: 'Attitude quaternion', unit: '',
    columns: ['q_w', 'q_x', 'q_y', 'q_z'], labels: ['w', 'x', 'y', 'z'] },
  { id: 'hacc', title: 'GPS horizontal accuracy', unit: 'm', columns: ['gps_h_acc_m'], labels: ['h acc'] },
  { id: 'sv', title: 'GPS satellites', unit: '', columns: ['num_sv'], labels: ['Satellites'] },
  { id: 'press', title: 'Baro pressure', unit: 'Pa', columns: ['baro_raw_pressure_pa'], labels: ['Pressure'] },
  { id: 'temp', title: 'Baro temperature', unit: '°C', columns: ['baro_temp_c'], labels: ['Temperature'] },
  { id: 'mag', title: 'Magnetic field', unit: 'µT',
    columns: ['mag_x_ut', 'mag_y_ut', 'mag_z_ut'], labels: ['X', 'Y', 'Z'] },
];

/** Shown when a flight opens. */
export const DEFAULT_SELECTION = ['fused_agl_m', 'raw_baro_agl_m', 'fused_vspeed_mps', 'raw_baro_vel_mps'];

/** Locator FlightStates (Rocket/Common/Inc/Types.hpp). */
export const FLIGHT_STATES: Record<number, string> = {
  0: 'Waiting for launch',
  1: 'Launch',
  2: 'Burnout',
  3: 'Nose-over',
  4: 'Drogue (primary)',
  5: 'Drogue (backup)',
  6: 'Main (primary)',
  7: 'Main (backup)',
  8: 'Landed',
};

export function flightStateName(s: number): string {
  return FLIGHT_STATES[s] ?? `State ${s}`;
}

/**
 * The short tag drawn on each event line, on every chart. One fixed tag per
 * state, so the same line reads the same everywhere; the hover tooltip and the
 * Flight events table give the full name.
 */
export const FLIGHT_STATE_ABBR: Record<number, string> = {
  0: 'Pad',
  1: 'LNCH',
  2: 'BO',
  3: 'NO',
  4: 'DRG',
  5: 'DRG2',
  6: 'MAIN',
  7: 'MAIN2',
  8: 'LND',
};

export function flightStateAbbr(s: number): string {
  return FLIGHT_STATE_ABBR[s] ?? `S${s}`;
}

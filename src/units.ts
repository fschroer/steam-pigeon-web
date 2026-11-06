// Display units (locator ADR "Units are SI underneath; English is a display
// choice"). The CSV, the KML and everything stored stay SI; this decides only how
// a number is charted and printed in this browser. Remembered per browser, the
// way the theme is, and not shared with the phone app.

import type { Panel } from './channels';

export type Units = 'metric' | 'english';

const KEY = 'sp.units';
export const FEET_PER_METER = 1 / 0.3048;

/**
 * English in a US-region browser (and Liberia and Myanmar), metric elsewhere,
 * until the viewer chooses.
 */
export function defaultUnits(language: string): Units {
  const region = /[-_]([A-Za-z]{2})\b/.exec(language)?.[1]?.toUpperCase();
  return region && ['US', 'LR', 'MM'].includes(region) ? 'english' : 'metric';
}

export function currentUnits(): Units {
  try {
    const u = localStorage.getItem(KEY);
    if (u === 'metric' || u === 'english') return u;
  } catch { /* storage blocked */ }
  return defaultUnits(typeof navigator === 'undefined' ? '' : navigator.language);
}

export function saveUnits(u: Units): void {
  try { localStorage.setItem(KEY, u); } catch { /* the choice lasts this page only */ }
}

/** A panel's unit and value conversion in [u]. Units with no English form (g, Pa, °) pass through. */
export function panelUnits(panel: Panel, u: Units): { unit: string; convert: (v: number) => number } {
  if (u === 'english') {
    switch (panel.unit) {
      case 'm': return { unit: 'ft', convert: (v) => v * FEET_PER_METER };
      case 'm/s': return { unit: 'ft/s', convert: (v) => v * FEET_PER_METER };
      case '°C': return { unit: '°F', convert: (v) => v * 9 / 5 + 32 };
    }
  }
  return { unit: panel.unit, convert: (v) => v };
}

/** An altitude for a readout: "123 m" or "404 ft". */
export function altitudeText(m: number, u: Units): string {
  return u === 'english' ? `${(m * FEET_PER_METER).toFixed(0)} ft` : `${m.toFixed(0)} m`;
}

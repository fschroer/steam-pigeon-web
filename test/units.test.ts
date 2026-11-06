import { describe, expect, it } from 'vitest';
import { PANELS } from '../src/channels';
import { altitudeText, defaultUnits, panelUnits } from '../src/units';

const panel = (id: string) => PANELS.find((p) => p.id === id)!;

describe('units', () => {
  it('defaults from the browser region', () => {
    expect(defaultUnits('en-US')).toBe('english');
    expect(defaultUnits('es_us')).toBe('english');
    expect(defaultUnits('en-GB')).toBe('metric');
    expect(defaultUnits('en')).toBe('metric');
    expect(defaultUnits('')).toBe('metric');
  });

  it('converts length, speed and temperature panels only', () => {
    const alt = panelUnits(panel('alt'), 'english');
    expect(alt.unit).toBe('ft');
    expect(alt.convert(100)).toBeCloseTo(328.084, 3);
    expect(panelUnits(panel('vel'), 'english').unit).toBe('ft/s');
    expect(panelUnits(panel('hacc'), 'english').unit).toBe('ft');
    const t = panelUnits(panel('temp'), 'english');
    expect(t.unit).toBe('°F');
    expect(t.convert(20)).toBeCloseTo(68, 6);
    expect(panelUnits(panel('acc'), 'english').unit).toBe('g');
    expect(panelUnits(panel('press'), 'english').unit).toBe('Pa');
    expect(panelUnits(panel('alt'), 'metric').convert(100)).toBe(100);
    expect(panelUnits(panel('alt'), 'metric').unit).toBe('m');
  });

  it('prints altitudes', () => {
    expect(altitudeText(1432.6, 'metric')).toBe('1433 m');
    expect(altitudeText(1432.6, 'english')).toBe('4700 ft');
  });
});

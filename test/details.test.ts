import { describe, expect, it } from 'vitest';
import { appendLog, cleanDetails, emptyDetails, motorSummary, parseDelays, logStamp, EX_MOTOR, detailsId } from '../src/details';

describe('flight details', () => {
  it('stamps and appends a log entry', () => {
    const d = new Date(2026, 10, 6, 21, 5);
    expect(logStamp(d)).toBe('2026-11-06 21:05');
    const one = appendLog('', '  Good flight ', d);
    expect(one).toBe('[2026-11-06 21:05] Good flight');
    expect(appendLog(one + '\n\n', 'Main late', d)).toBe('[2026-11-06 21:05] Good flight\n[2026-11-06 21:05] Main late');
    expect(appendLog(one, '   ', d)).toBe(one);
  });

  it('splits ThrustCurve delays', () => {
    expect(parseDelays('4,6,8,10,P')).toEqual(['4', '6', '8', '10', 'P']);
    expect(parseDelays(undefined)).toEqual([]);
  });

  it('summarizes a motor', () => {
    expect(motorSummary({ maker: 'AeroTech', impulse: 'H', motor: 'H128W', delay: '10' })).toBe('AeroTech H128W-10');
    expect(motorSummary({ maker: EX_MOTOR, impulse: 'K', motor: '', delay: '' })).toBe('EX K');
  });

  it('drops empty motors and trims', () => {
    const c = cleanDetails({ ...emptyDetails(), rocketName: '  Red Ryder ',
      motors: [{ maker: '', impulse: '', motor: '', delay: '' }, { maker: 'Estes', impulse: 'C', motor: 'C6', delay: '5' }] });
    expect(c.rocketName).toBe('Red Ryder');
    expect(c.motors).toEqual([{ maker: 'Estes', impulse: 'C', motor: 'C6', delay: '5' }]);
  });

  it('shares its id prefix with the record’s shares', () => {
    expect(detailsId('U', '42', '1_0000abcd')).toBe('U_42_1_0000abcd');
  });
});

import { firstMatch } from '../src/detailsForm';

describe('Tab completion', () => {
  const opts = [{ value: 'AeroTech', label: 'AeroTech' }, { value: 'Cesaroni', label: 'Cesaroni Technology' }, { value: 'Estes', label: 'Estes Industries' }];
  it('takes the first match in list order', () => {
    expect(firstMatch('ces', opts)).toBe('Cesaroni');
    expect(firstMatch('tech', opts)).toBe('AeroTech');
    expect(firstMatch('industries', opts)).toBe('Estes');
  });
  it('keeps an exact match and leaves no match alone', () => {
    expect(firstMatch('estes', opts)).toBe('Estes');
    expect(firstMatch('zzz', opts)).toBeUndefined();
    expect(firstMatch('  ', opts)).toBeUndefined();
  });
});

import { filterOptions } from '../src/detailsForm';

describe('dropdown list', () => {
  const opts = [{ value: 'Estes' }, { value: 'LOC Precision' }, { value: 'Madcow Rocketry' }];
  it('shows everything on entering the field, whatever is typed there', () => {
    expect(filterOptions('Estes', opts, true)).toHaveLength(3);
  });
  it('narrows once the user types', () => {
    expect(filterOptions('ma', opts, false).map((o) => o.value)).toEqual(['Madcow Rocketry']);
    expect(filterOptions('', opts, false)).toHaveLength(3);
  });
});

import { splitElectronics, joinElectronics } from '../src/details';

describe('electronics list', () => {
  it('round-trips devices', () => {
    const s = joinElectronics(['Featherweight Raven', ' ', 'Eggtimer Quasar']);
    expect(s).toBe('Featherweight Raven; Eggtimer Quasar');
    expect(splitElectronics(s)).toEqual(['Featherweight Raven', 'Eggtimer Quasar']);
  });
  it('keeps old free text as one device', () => {
    expect(splitElectronics('RRC3, Raven')).toEqual(['RRC3, Raven']);
  });
});

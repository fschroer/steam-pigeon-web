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

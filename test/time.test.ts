import { describe, expect, it } from 'vitest';
import { utcOffsetText } from '../src/time';

describe('utcOffsetText', () => {
  it('formats minutes east of UTC', () => {
    const at = (min: number) => ({ getTimezoneOffset: () => min }) as unknown as Date;
    expect(utcOffsetText(at(480))).toBe('-08:00');
    expect(utcOffsetText(at(420))).toBe('-07:00');
    expect(utcOffsetText(at(0))).toBe('+00:00');
    expect(utcOffsetText(at(-345))).toBe('+05:45');
  });
});

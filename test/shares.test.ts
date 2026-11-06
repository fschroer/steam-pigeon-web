import { describe, expect, it } from 'vitest';
import { normalizeEmail, shareId, sharedCsvPath } from '../src/shares';

describe('shares', () => {
  it('normalizes an address the way the rules compare it', () => {
    expect(normalizeEmail('  Frank.S@Example.COM ')).toBe('frank.s@example.com');
    expect(normalizeEmail('not an address')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('a/b@c.d')).toBeNull();
  });

  it('builds the id storage.rules rebuilds from the path', () => {
    expect(shareId('UID123', '1136992075', '1793850623_774cb6e5', 'x@y.com'))
      .toBe('UID123_1136992075_1793850623_774cb6e5_x@y.com');
  });

  it('points at the owner’s CSV', () => {
    expect(sharedCsvPath({ ownerUid: 'UID123', locatorId: '42', recordKey: '1_0000abcd' }))
      .toBe('users/UID123/locators/42/1_0000abcd.csv');
  });
});

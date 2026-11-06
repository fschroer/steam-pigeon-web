import { describe, expect, it } from 'vitest';
import { formatPlace } from '../src/place';

describe('formatPlace', () => {
  it('names a US town and state', () => {
    expect(formatPlace({ town: 'Gerlach', county: 'Washoe County', state: 'Nevada', country: 'United States', country_code: 'us' }))
      .toBe('Gerlach, Nevada');
  });
  it('falls back to the county in open country', () => {
    expect(formatPlace({ county: 'Pershing County', state: 'Nevada', country_code: 'us' })).toBe('Pershing County, Nevada');
  });
  it('adds the country outside the US', () => {
    expect(formatPlace({ village: 'Elsdorf', state: 'North Rhine-Westphalia', country: 'Germany', country_code: 'de' }))
      .toBe('Elsdorf, North Rhine-Westphalia, Germany');
  });
  it('gives nothing for an empty answer', () => {
    expect(formatPlace({})).toBeUndefined();
    expect(formatPlace(undefined)).toBeUndefined();
  });
});

// DR-02: times are shown in East Africa Time as "YYYY-MM-DD HH:mm EAT",
// whatever the browser's time zone. Run under three process time zones; the
// output must be identical.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eatLocalToIso, formatEAT, fmtRelative } from '../lib/format';

const ORIGINAL_TZ = process.env.TZ;

describe.each([
  ['Africa/Nairobi', -180],
  ['UTC', 0],
  // October 2026 is daylight time in New York (UTC-4).
  ['America/New_York', 240],
])('with TZ=%s', (tz, offsetMinutes) => {
  beforeAll(() => { process.env.TZ = tz; });
  afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

  test('the process really is in that zone', () => {
    expect(new Date('2026-10-13T12:00:00Z').getTimezoneOffset()).toBe(offsetMinutes);
  });

  test.each([
    ['2026-10-13T15:00:00Z', '2026-10-13 18:00 EAT'],
    ['2026-10-13T21:30:00.000Z', '2026-10-14 00:30 EAT'], // crosses midnight in Nairobi
    ['2026-12-31T21:00:00Z', '2027-01-01 00:00 EAT'], // and the year
    ['2026-03-08T07:05:00Z', '2026-03-08 10:05 EAT'], // New York's DST change day
    ['2026-10-13T00:00:00+03:00', '2026-10-13 00:00 EAT'],
  ])('formatEAT(%s) is %s', (instant, expected) => {
    expect(formatEAT(instant)).toBe(expected);
    expect(formatEAT(new Date(instant))).toBe(expected);
  });

  test('date and time parts', () => {
    expect(formatEAT('2026-10-13T21:30:00Z', 'date')).toBe('2026-10-14');
    expect(formatEAT('2026-10-13T21:30:00Z', 'time')).toBe('00:30 EAT');
  });

  test('missing or invalid values show a dash', () => {
    for (const v of [null, undefined, '', 'not a date']) expect(formatEAT(v)).toBe('—');
  });

  test('a datetime-local value is read as EAT, not as the browser zone', () => {
    expect(eatLocalToIso('2026-10-13T18:05')).toBe('2026-10-13T15:05:00.000Z');
    expect(eatLocalToIso('2026-10-14T01:00')).toBe('2026-10-13T22:00:00.000Z');
    expect(eatLocalToIso('2026-10-13T18:05:30')).toBe('2026-10-13T15:05:30.000Z');
    expect(eatLocalToIso('13/10/2026 18:05')).toBeNull();
    // Round trip.
    expect(formatEAT(eatLocalToIso('2026-10-13T18:05'))).toBe('2026-10-13 18:05 EAT');
  });

  test('old dates in fmtRelative fall back to the EAT date', () => {
    expect(fmtRelative('2020-01-01T22:00:00Z')).toBe('2020-01-02');
  });
});

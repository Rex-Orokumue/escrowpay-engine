import { describe, expect, test } from 'vitest';
import { formatNaira } from './currency';

describe('formatNaira', () => {
  test('formats kobo as naira with two decimals', () => {
    expect(formatNaira(120000)).toBe('₦1,200.00');
  });

  test('formats zero', () => {
    expect(formatNaira(0)).toBe('₦0.00');
  });

  test('formats large amounts with thousands separators', () => {
    expect(formatNaira(842000000)).toBe('₦8,420,000.00');
  });
});

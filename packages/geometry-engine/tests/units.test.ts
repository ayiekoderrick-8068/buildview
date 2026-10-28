import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, lengthToInputText } from '../src/index.ts';

describe('display units', () => {
  it('formats the same length in every unit without changing it', () => {
    const m = 5.2;
    expect(formatLength(m, 'mm')).toBe('5200 mm');
    expect(formatLength(m, 'cm')).toBe('520.0 cm');
    expect(formatLength(m, 'm')).toBe('5.200 m');
    expect(formatLength(m, 'ft-in')).toBe('17′ 0 3/4″'); // 204.72 in = 17 ft 0.72 in -> nearest 1/8"
    expect(m).toBe(5.2);
  });

  it('formats feet and inches without carrying 12 inches', () => {
    expect(formatLength(0.3048, 'ft-in')).toBe('1′ 0″');
    expect(formatLength(0.3047, 'ft-in')).toBe('1′ 0″');
    expect(formatLength(0.0254 * 11.99, 'ft-in')).toBe('1′ 0″');
    expect(formatLength(-0.0254 * 6, 'ft-in')).toBe('-0′ 6″');
  });

  it('parses user input in the active unit', () => {
    expect(parseLength('5200', 'mm')).toBeCloseTo(5.2);
    expect(parseLength('520', 'cm')).toBeCloseTo(5.2);
    expect(parseLength('5.2', 'm')).toBeCloseTo(5.2);
    expect(parseLength('5,2', 'm')).toBeCloseTo(5.2);
    expect(parseLength(`17' 0 5/8"`, 'ft-in')).toBeCloseTo(5.2, 2);
    expect(parseLength('3ft 6in', 'ft-in')).toBeCloseTo(1.0668);
    expect(parseLength('42', 'ft-in')).toBeCloseTo(1.0668); // bare number = inches
    expect(parseLength('abc', 'm')).toBeNull();
    expect(parseLength('', 'mm')).toBeNull();
    expect(parseLength('5 m', 'm')).toBeNull();
  });

  it('round-trips through the input text', () => {
    for (const unit of ['mm', 'cm', 'm'] as const) {
      expect(parseLength(lengthToInputText(2.345, unit), unit)).toBeCloseTo(2.345, 4);
    }
  });
});

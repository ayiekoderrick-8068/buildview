/**
 * Display units. Geometry is ALWAYS stored in metres; changing the display unit only changes how
 * numbers are formatted and parsed, never the model.
 */
export type DisplayUnit = 'mm' | 'cm' | 'm' | 'ft-in';

export const DISPLAY_UNITS: ReadonlyArray<{ value: DisplayUnit; label: string }> = [
  { value: 'mm', label: 'Millimetres' },
  { value: 'cm', label: 'Centimetres' },
  { value: 'm', label: 'Metres' },
  { value: 'ft-in', label: 'Feet & inches' },
];

const INCH = 0.0254;

export function formatLength(m: number, unit: DisplayUnit): string {
  if (!Number.isFinite(m)) return '-';
  switch (unit) {
    case 'mm':
      return `${(m * 1000).toFixed(0)} mm`;
    case 'cm':
      return `${(m * 100).toFixed(1)} cm`;
    case 'm':
      return `${m.toFixed(3)} m`;
    case 'ft-in': {
      const sign = m < 0 ? '-' : '';
      let inches = Math.round((Math.abs(m) / INCH) * 8) / 8; // 1/8 inch resolution
      let ft = Math.floor(inches / 12);
      inches -= ft * 12;
      if (inches >= 12) {
        ft += 1;
        inches = 0;
      }
      const whole = Math.floor(inches);
      const frac = inches - whole;
      const eighths = Math.round(frac * 8);
      const fracStr = eighths === 0 ? '' : ` ${eighths / gcd(eighths, 8)}/${8 / gcd(eighths, 8)}`;
      return `${sign}${ft}′ ${whole}${fracStr}″`;
    }
  }
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Numeric value shown in an input box for a length (millimetres, centimetres, metres, or total inches). */
export function lengthToInputText(m: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'mm':
      return String(Math.round(m * 1000 * 100) / 100);
    case 'cm':
      return String(Math.round(m * 100 * 1000) / 1000);
    case 'm':
      return String(Math.round(m * 1e5) / 1e5);
    case 'ft-in':
      return formatLength(m, 'ft-in');
  }
}

/** Parses user text in the given unit to metres, or null when it is not a valid length. */
export function parseLength(text: string, unit: DisplayUnit): number | null {
  const t = text.trim().replace(/,/g, '.');
  if (!t) return null;
  if (unit === 'ft-in') {
    const m = t.match(/^(-)?\s*(?:(\d+(?:\.\d+)?)\s*(?:′|'|ft|feet)\s*)?(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?\s*(?:″|"|in|inch|inches)?)?\s*$/i);
    if (!m || (m[2] === undefined && m[3] === undefined)) return null;
    const ft = m[2] ? Number(m[2]) : 0;
    let inches = m[3] ? Number(m[3]) : 0;
    if (m[4] && m[5]) inches += Number(m[4]) / Number(m[5]);
    const total = (ft * 12 + inches) * INCH;
    return m[1] ? -total : total;
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return unit === 'mm' ? v / 1000 : unit === 'cm' ? v / 100 : v;
}

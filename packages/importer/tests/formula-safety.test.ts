import { describe, expect, it } from 'vitest';

import { isFormulaLiteralPhone, safeCellValue } from '../src/cell.js';

describe('formula safety', () => {
  it('retains the expression and never reads a cached result', () => {
    const value = safeCellValue({
      formula: 'HYPERLINK("https://invalid.example", "run")',
      result: 'attacker-controlled cached value',
    });

    expect(value).toEqual({
      kind: 'formula',
      value: { expression: '=HYPERLINK("https://invalid.example", "run")' },
      scalarText: '=HYPERLINK("https://invalid.example", "run")',
      isFormula: true,
    });
    expect(JSON.stringify(value)).not.toContain('attacker-controlled');
    expect(value === null ? false : isFormulaLiteralPhone(value)).toBe(false);
  });

  it('recognizes only a literal formula-shaped phone', () => {
    const value = safeCellValue({ formula: '+79131234567', result: 7_913_123_456_7 });
    expect(value).not.toBeNull();
    expect(value === null ? false : isFormulaLiteralPhone(value)).toBe(true);
  });
});

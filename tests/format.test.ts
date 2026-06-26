import { describe, it, expect } from 'vitest';
import { truncate, stroopsToXlm, xlmToStroops, pct, timeLeft } from '@/lib/format';

describe('truncate', () => {
  it('shortens long', () => expect(truncate('CABCDEFGHIJKLMNOPQRSTUV')).toBe('CABCD…QRSTUV'.slice(0,5)+'…'+'CABCDEFGHIJKLMNOPQRSTUV'.slice(-4)));
  it('keeps short', () => expect(truncate('CABC')).toBe('CABC'));
});

describe('stroopsToXlm', () => {
  it('whole', () => expect(stroopsToXlm(10000000n)).toBe('1'));
  it('fraction', () => expect(stroopsToXlm(15000000n)).toBe('1.5'));
  it('zero', () => expect(stroopsToXlm(0n)).toBe('0'));
});

describe('xlmToStroops', () => {
  it('whole', () => expect(xlmToStroops('2')).toBe(20000000n));
  it('fraction', () => expect(xlmToStroops('1.5')).toBe(15000000n));
  it('rejects bad', () => expect(() => xlmToStroops('abc')).toThrow());
});

describe('pct', () => {
  it('half', () => expect(pct(50n, 100n)).toBe(50));
  it('clamps over', () => expect(pct(150n, 100n)).toBe(100));
  it('zero goal', () => expect(pct(10n, 0n)).toBe(0));
});

describe('timeLeft', () => {
  it('ended', () => expect(timeLeft(100, 200)).toBe('ended'));
  it('hours', () => expect(timeLeft(1000 + 3600 * 5, 1000)).toBe('5h 0m'));
});

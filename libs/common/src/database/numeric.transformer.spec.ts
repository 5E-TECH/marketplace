import { numericTransformer } from './numeric.transformer';

// TC4: pul qiymatida drift bo'lmaydi (numeric string -> number)
describe('numericTransformer (TC4)', () => {
  it('string qiymatni number ga aylantiradi', () => {
    expect(numericTransformer.from('149900.50')).toBe(149900.5);
    expect(numericTransformer.from('0.00')).toBe(0);
    expect(numericTransformer.from('12345678.90')).toBe(12345678.9);
  });

  it('null/undefined saqlanadi', () => {
    expect(numericTransformer.from(null)).toBeNull();
    expect(numericTransformer.from(undefined)).toBeUndefined();
  });

  it("qo'shishda drift bermaydi", () => {
    const a = numericTransformer.from('10.00') as number;
    const b = numericTransformer.from('5.05') as number;
    expect(a + b).toBe(15.05);
  });
});

import {
  MAX_MONEY,
  moneyFromDb,
  moneyOrNull,
  moneyTransformer,
} from './money.transformer';

describe('moneyTransformer (BE-01)', () => {
  it('BIGINT satri → butun son; null o‘zgarmaydi', () => {
    expect(moneyTransformer.from('250000')).toBe(250000);
    expect(moneyTransformer.from(null)).toBeNull();
    expect(moneyOrNull(null)).toBeNull();
    expect(moneyFromDb('0')).toBe(0);
    // raw SQL dagi bo'sh qiymat COALESCE kabi 0 bo'ladi
    expect(moneyFromDb(null)).toBe(0);
    expect(moneyOrNull('15000')).toBe(15000);
  });

  it('TC1: 249 999 + 1 = aynan 250 000; TC2: 1 000 000 × 1% = 10 000, kasr yo‘q', () => {
    const a = moneyFromDb('249999');
    const b = moneyFromDb('1');
    expect(a + b).toBe(250000);
    const pct = Math.round((moneyFromDb('1000000') * 1) / 100);
    expect(Number.isSafeInteger(pct) && pct === 10000).toBe(true);
  });

  it('kasr so‘m yozilmaydi; juda katta qiymat xato', () => {
    expect(() => moneyTransformer.to(10.5)).toThrow();
    expect(moneyTransformer.to(262000)).toBe(262000);
    expect(() => moneyTransformer.from('99999999999999999999')).toThrow();
    // NUMERIC(14,2) butun qism chegarasi saqlanadi (payment/finance hali shunda)
    expect(moneyTransformer.to(MAX_MONEY)).toBe(MAX_MONEY);
    expect(() => moneyTransformer.to(MAX_MONEY + 1)).toThrow('chegaradan');
  });
});

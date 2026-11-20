import {
  AffiliateStreamStatus,
  CatalogOfferSnapshot,
  LandingPageState,
} from '@app/common';
import { landingState } from './landing.service';
import { canOpenStream } from './offer-math';

/**
 * BE-16: qoldiq HQ ombordan; inventory javob bermasa catalog `stock: null` (noma’lum) beradi.
 * Ochiq sahifa va lid qabul qilish yopilmaydi, yangi sahifa ochish — yopiq.
 */
describe('noma’lum qoldiq (BE-16)', () => {
  const offer = (stock: number | null) =>
    ({
      withdrawn: false,
      cpaAvailable: true,
      approvedPrice: 270000,
      stock,
    }) as CatalogOfferSnapshot;
  const active = { status: AffiliateStreamStatus.ACTIVE };

  it('sahifa holati: null → ochiq (lid qabul qilinadi), 0 → vaqtincha yo‘q', () => {
    expect(landingState(active, offer(null))).toBe(LandingPageState.OPEN);
    expect(landingState(active, offer(0))).toBe(LandingPageState.OUT_OF_STOCK);
    expect(landingState(active, offer(3))).toBe(LandingPageState.OPEN);
  });

  it('yangi sahifa: null va 0 → ochilmaydi, musbat → ochiladi', () => {
    expect(canOpenStream(offer(null))).toBe(false);
    expect(canOpenStream(offer(0))).toBe(false);
    expect(canOpenStream(offer(3))).toBe(true);
  });
});

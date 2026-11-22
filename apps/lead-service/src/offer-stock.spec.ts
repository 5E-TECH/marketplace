import {
  AffiliateStreamStatus,
  CatalogOfferSnapshot,
  LandingPageState,
} from '@app/common';
import { landingState } from './landing.service';
import { canOpenStream, isOfferVisible } from './offer-math';

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
      creatives: [{ id: '1', type: 'VIDEO', url: 'https://cdn/v.mp4' }],
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

describe('videosiz offer (BE-27, SOT-9)', () => {
  const offer = (types: Array<'IMAGE' | 'VIDEO'>) =>
    ({
      withdrawn: false,
      cpaAvailable: true,
      approvedPrice: 270000,
      stock: 5,
      creatives: types.map((type, i) => ({
        id: String(i + 1),
        type,
        url: `https://cdn/${i}`,
      })),
    }) as CatalogOfferSnapshot;
  const active = { status: AffiliateStreamStatus.ACTIVE };

  it('TC5: videosiz offer sotuvchiga ko‘rinmaydi va sahifa ochilmaydi; video qo‘shilgach — ko‘rinadi', () => {
    expect(isOfferVisible(offer([]))).toBe(false);
    expect(isOfferVisible(offer(['IMAGE', 'IMAGE']))).toBe(false);
    expect(canOpenStream(offer(['IMAGE']))).toBe(false);
    expect(isOfferVisible(offer(['IMAGE', 'VIDEO']))).toBe(true);
    expect(canOpenStream(offer(['VIDEO']))).toBe(true);
  });

  it('mavjud sahifa video o‘chirilsa ham lid qabul qiladi [taklif]', () => {
    expect(landingState(active, offer([]))).toBe(LandingPageState.OPEN);
  });
});

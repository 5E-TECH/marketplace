import { IS_PUBLIC_KEY } from '@app/common';
import { StorefrontController } from './storefront.controller';

describe('StorefrontController', () => {
  it('barcha storefront endpointlari public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, StorefrontController)).toBe(true);
  });
});

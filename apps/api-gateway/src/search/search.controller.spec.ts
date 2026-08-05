import { IS_PUBLIC_KEY } from '@app/common';
import { SearchController } from './search.controller';

describe('SearchController', () => {
  it('storefront search endpointi public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SearchController)).toBe(true);
  });
});

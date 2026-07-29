import { IS_PUBLIC_KEY, Role, ROLES_KEY } from '@app/common';
import { CategoriesController } from './categories.controller';

describe('CategoriesController access metadata', () => {
  it('public tree autentifikatsiyasiz ochiq', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        CategoriesController.prototype.publicTree,
      ),
    ).toBe(true);
  });

  it.each(['adminTree', 'create', 'update', 'remove'] as const)(
    '%s faqat ADMIN va SUPERADMIN uchun ochiq',
    (method) => {
      expect(
        Reflect.getMetadata(ROLES_KEY, CategoriesController.prototype[method]),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    },
  );
});

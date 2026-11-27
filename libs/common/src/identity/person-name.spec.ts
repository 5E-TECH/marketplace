import { of } from 'rxjs';
import { Role } from '../enums';
import { shortPersonName, staffRoleLabel } from './person-name';
import { UserNamesClient } from './user-names.client';

/** Hujjatlarda qisqa ism va lavozim (dizayn `hujjat-*`: «Otabek N., omborchi»). */
describe('person-name', () => {
  it.each([
    ['Jasur Toshmatov', 'Jasur T.'],
    ['  Otabek   Nurmatov Ali o‘g‘li ', 'Otabek N.'],
    ['Dilnoza', 'Dilnoza'],
    ['+998 90 123 45 67', '+998 90 123 45 67'],
    ['Шерзод алиев', 'Шерзод А.'],
  ])('shortPersonName(%p) = %p — frontend bilan bir xil', (name, short) => {
    expect(shortPersonName(name)).toBe(short);
  });

  it('lavozim: omborchi, superadmin, admin; boshqasi — bo‘sh', () => {
    expect(staffRoleLabel(Role.WAREHOUSE)).toBe('omborchi');
    expect(staffRoleLabel(Role.SUPERADMIN)).toBe('superadmin');
    expect(staffRoleLabel(Role.ADMIN)).toBe('admin');
    expect(staffRoleLabel(Role.OPERATOR_LEAD)).toBe('');
    expect(staffRoleLabel(null)).toBe('');
  });

  it('UserNamesClient.lookup: ism va rol bilan; `resolve` avvalgidek `#ID`', async () => {
    const send = jest.fn(() =>
      of([
        { id: '12', name: 'Jasur Toshmatov', role: Role.WAREHOUSE },
        { id: '13', name: null, role: Role.ADMIN },
      ]),
    );
    const client = new UserNamesClient({ send } as never);
    const rows = await client.lookup(['12', '13', '12', null]);
    expect(rows.get('12')).toEqual({
      id: '12',
      name: 'Jasur Toshmatov',
      role: Role.WAREHOUSE,
    });
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.user.names' },
      { ids: ['12', '13'] },
    );
    const name = await client.resolve(['12', '13']);
    expect([name('12'), name('13')]).toEqual(['Jasur Toshmatov', '#13']);
  });
});

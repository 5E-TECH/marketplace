import { AddProvisionTariffs1725375600000 } from './1725375600000-add-provision-tariffs';

describe('AddProvisionTariffs1725375600000', () => {
  it('provisioning snapshotiga geo va tarif ustunlarini qo‘shadi/qaytaradi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddProvisionTariffs1725375600000();

    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('region_id'));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('tariff_home'));

    query.mockClear();
    await migration.down({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DROP COLUMN'));
  });
});

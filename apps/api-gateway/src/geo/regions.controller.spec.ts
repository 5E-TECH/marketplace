import { of } from 'rxjs';
import { RegionsController } from './regions.controller';

describe('RegionsController', () => {
  it('viloyatlar ro‘yxatini integration servisidan oladi', async () => {
    const integration = {
      send: jest.fn(() => of([{ id: '1', name: 'Toshkent shahri' }])),
    };
    const controller = new RegionsController(integration as never);

    await expect(controller.getRegions()).resolves.toEqual([
      { id: '1', name: 'Toshkent shahri' },
    ]);
    expect(integration.send).toHaveBeenCalledWith(
      { cmd: 'integration.regions.list' },
      {},
    );
  });

  it('tanlangan viloyat tumanlarini integration servisidan oladi', async () => {
    const integration = {
      send: jest.fn(() =>
        of([{ id: '10', regionId: '1', name: 'Yunusobod tumani' }]),
      ),
    };
    const controller = new RegionsController(integration as never);

    await expect(controller.getDistricts('1')).resolves.toEqual([
      { id: '10', regionId: '1', name: 'Yunusobod tumani' },
    ]);
    expect(integration.send).toHaveBeenCalledWith(
      { cmd: 'integration.districts.list' },
      { regionId: '1' },
    );
  });
});

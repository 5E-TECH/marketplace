import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { LeadErrorCode } from '@app/common';
import { LeadAddressService } from './lead-address.service';

describe('LeadAddressService (BE-38)', () => {
  const make = (result: unknown) => {
    const integration = { send: jest.fn(() => of(result)) };
    return {
      service: new LeadAddressService({} as never, integration as never),
      integration,
    };
  };

  it('geo xatosi → 400, xabar maydon nomi bilan boshlanadi (details[].field)', async () => {
    const { service, integration } = make({
      ok: false,
      field: 'districtSoato',
      error: 'districtSoato tanlangan viloyatga tegishli emas',
    });
    const err = await service
      .resolve({ regionSoato: '1726', districtSoato: '1703206' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      message: ['districtSoato tanlangan viloyatga tegishli emas'],
    });
    expect(integration.send).toHaveBeenCalledWith(
      { cmd: 'integration.geo.resolve-address' },
      { regionSoato: '1726', districtSoato: '1703206' },
    );
  });

  it('TC4: manzil tasdiqlanmagan lid → 400 ADDRESS_NOT_CONFIRMED', () => {
    const { service } = make(null);
    let caught: unknown;
    try {
      service.assertConfirmable({ addressConfirmedAt: null });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toMatchObject({
      errorCode: LeadErrorCode.ADDRESS_NOT_CONFIRMED,
    });
    expect(() =>
      service.assertConfirmable({ addressConfirmedAt: new Date() }),
    ).not.toThrow();
  });
});

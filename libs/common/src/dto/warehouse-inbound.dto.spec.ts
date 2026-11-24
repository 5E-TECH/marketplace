import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InboundShipmentQueryDto } from './warehouse-inbound.dto';

const parse = (query: Record<string, unknown>) => {
  const dto = plainToInstance(InboundShipmentQueryDto, query);
  return { dto, errors: validateSync(dto).map((error) => error.property) };
};

/** BE-25 (FE-16): postavkalar ro‘yxati filtrlari. */
describe('InboundShipmentQueryDto', () => {
  it('holat: bitta, vergul bilan va takroriy parametr', () => {
    expect(parse({ status: 'DECLARED' }).dto.status).toEqual(['DECLARED']);
    expect(parse({ status: 'DECLARED, IN_TRANSIT' }).dto.status).toEqual([
      'DECLARED',
      'IN_TRANSIT',
    ]);
    expect(
      parse({ status: ['DECLARED', 'IN_TRANSIT', 'DECLARED'] }).dto.status,
    ).toEqual(['DECLARED', 'IN_TRANSIT']);
    expect(parse({ status: '' }).dto.status).toBeUndefined();
    expect(parse({}).errors).toEqual([]);
  });

  it('noma’lum holat va mavjud bo‘lmagan sana — xato', () => {
    expect(parse({ status: 'DECLARED,CANCELLED' }).errors).toEqual(['status']);
    expect(
      parse({
        expectedFrom: '2026-13-01',
        expectedTo: '01.12.2026',
        receivedOn: '2026-12',
      }).errors.sort(),
    ).toEqual(['expectedFrom', 'expectedTo', 'receivedOn']);
    expect(
      parse({ expectedFrom: '2026-12-01', expectedTo: '2026-12-07' }).errors,
    ).toEqual([]);
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  FinanceLedgerQueryDto,
  SellerFinanceLedgerQueryDto,
  SellerFinancePayoutQueryDto,
  UpdatePayoutScheduleDto,
} from './finance.dto';

// Gateway'dagi global ValidationPipe bilan bir xil sozlama.
const strict = { whitelist: true, forbidNonWhitelisted: true };

describe('Finance query DTO', () => {
  it('admin ledger: shopId, davr va pagination qabul qilinadi', async () => {
    const dto = plainToInstance(FinanceLedgerQueryDto, {
      shopId: '7',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      page: '2',
    });
    await expect(validate(dto, strict)).resolves.toHaveLength(0);
    expect(dto.page).toBe(2);
  });

  it('sotuvchi query’sida shopId taqiqlangan', async () => {
    for (const type of [
      SellerFinanceLedgerQueryDto,
      SellerFinancePayoutQueryDto,
    ]) {
      const errors = await validate(
        plainToInstance(type, { shopId: '999' }),
        strict,
      );
      expect(errors.map((error) => error.property)).toEqual(['shopId']);
    }
  });

  it('sotuvchi ledger: davr va pagination meros qilinadi', async () => {
    const valid = plainToInstance(SellerFinanceLedgerQueryDto, {
      dateFrom: '2026-09-01',
      limit: '50',
    });
    await expect(validate(valid, strict)).resolves.toHaveLength(0);
    expect(valid.limit).toBe(50);

    const invalid = plainToInstance(SellerFinanceLedgerQueryDto, {
      dateTo: 'kecha',
      limit: '500',
    });
    const errors = await validate(invalid, strict);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'dateTo',
      'limit',
    ]);
  });

  it('payout jadvali faqat DAILY/WEEKLY/MONTHLY', async () => {
    await expect(
      validate(
        plainToInstance(UpdatePayoutScheduleDto, { frequency: 'DAILY' }),
      ),
    ).resolves.toHaveLength(0);
    const errors = await validate(
      plainToInstance(UpdatePayoutScheduleDto, { frequency: 'YEARLY' }),
    );
    expect(errors.map((error) => error.property)).toEqual(['frequency']);
  });
});

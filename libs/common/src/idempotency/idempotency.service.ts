import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';

/**
 * Amalni idempotency kaliti bilan o'raydi:
 *  - kalit avval ko'rilgan bo'lsa → saqlangan natija (fn qayta ishlamaydi),
 *  - aks holda → fn bajariladi va natija saqlanadi.
 * Concurrency: bir vaqtda ikki xil so'rovda unique buzilsa, mavjud yozuv qaytariladi.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly repo: Repository<IdempotencyRecord>,
  ) {}

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = await this.repo.findOne({ where: { key } });
    if (existing) return existing.response as T;

    const result = await fn();
    try {
      await this.repo.save(this.repo.create({ key, response: result as unknown }));
    } catch (e) {
      if (e instanceof QueryFailedError) {
        // parallel so'rov allaqachon yozgan — o'sha natijani qaytaramiz
        const race = await this.repo.findOne({ where: { key } });
        if (race) return race.response as T;
      }
      throw e;
    }
    return result;
  }
}

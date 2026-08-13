import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  assertSafeUrl,
  CreatePaymentDto,
  decryptSecret,
  encryptSecret,
  PaymentProvider,
  PaymentResultDto,
  PaymentStatus,
  UpsertProviderConfigDto,
} from '@app/common';
import { Payment } from './entities/payment.entity';
import { ProviderConfig } from './entities/provider-config.entity';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(ProviderConfig)
    private readonly providerConfigs: Repository<ProviderConfig>,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreatePaymentDto): Promise<PaymentResultDto> {
    const existing = await this.payments.findOne({
      where: {
        salesOrderId: dto.salesOrderId,
        provider: dto.provider,
        status: In([
          PaymentStatus.CREATED,
          PaymentStatus.PENDING,
          PaymentStatus.PAID,
        ]),
      },
      order: { createdAt: 'DESC' },
    });
    if (existing) {
      if (Number(existing.amount) !== Number(dto.amount)) {
        throw new BadRequestException(
          'Buyurtma uchun mavjud to‘lov summasi mos emas',
        );
      }
      return this.toResult(existing);
    }

    const payment = this.payments.create({
      salesOrderId: dto.salesOrderId,
      provider: dto.provider,
      amount: dto.amount,
      status: PaymentStatus.CREATED,
      externalTxnId: null,
      paidAt: null,
    });
    return this.toResult(await this.payments.save(payment));
  }

  async upsertProviderConfig(
    provider: PaymentProvider,
    dto: UpsertProviderConfigDto,
  ): Promise<Omit<ProviderConfig, 'secretEncrypted'>> {
    if (dto.baseUrl) assertSafeUrl(dto.baseUrl);

    const current = await this.providerConfigs.findOne({
      where: { provider },
      select: {
        id: true,
        provider: true,
        merchantId: true,
        secretEncrypted: true,
        baseUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const entity = current ?? this.providerConfigs.create({ provider });
    if (dto.merchantId !== undefined) entity.merchantId = dto.merchantId;
    if (dto.baseUrl !== undefined) entity.baseUrl = dto.baseUrl;
    if (dto.isActive !== undefined) entity.isActive = dto.isActive;
    if (dto.secret !== undefined) {
      entity.secretEncrypted = encryptSecret(dto.secret, this.encryptionKey());
    }
    const saved = await this.providerConfigs.save(entity);
    return this.withoutSecret(saved);
  }

  async getProviderSecret(provider: PaymentProvider): Promise<string | null> {
    const entity = await this.providerConfigs.findOne({
      where: { provider, isActive: true },
      select: { id: true, secretEncrypted: true },
    });
    if (!entity?.secretEncrypted) return null;
    return decryptSecret(entity.secretEncrypted, this.encryptionKey());
  }

  private encryptionKey(): string {
    return this.config.getOrThrow<string>('INTEGRATION_CREDENTIAL_SECRET');
  }

  private toResult(payment: Payment): PaymentResultDto {
    return {
      id: payment.id,
      salesOrderId: payment.salesOrderId,
      provider: payment.provider,
      amount: Number(payment.amount),
      status: payment.status,
      createdAt: payment.createdAt,
    };
  }

  private withoutSecret(
    entity: ProviderConfig,
  ): Omit<ProviderConfig, 'secretEncrypted'> {
    const { secretEncrypted: _secret, ...safe } = entity;
    return safe;
  }
}

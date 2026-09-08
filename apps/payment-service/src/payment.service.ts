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
import { paymentAtomic, validReference } from './payment-atomic';

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
    if (
      !validReference(dto.salesOrderId) ||
      !Number.isFinite(dto.amount) ||
      dto.amount <= 0 ||
      dto.amount >= 1e12
    )
      throw new BadRequestException(
        'To‘lov summasi yoki buyurtma ID noto‘g‘ri',
      );
    return paymentAtomic(this.payments, (manager) =>
      new PaymentService(
        manager.getRepository(Payment),
        manager.getRepository(ProviderConfig),
        this.config,
      ).createLocked(dto),
    );
  }

  private async createLocked(dto: CreatePaymentDto): Promise<PaymentResultDto> {
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
        serviceId: true,
        secretEncrypted: true,
        baseUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const entity = current ?? this.providerConfigs.create({ provider });
    if (dto.merchantId !== undefined) entity.merchantId = dto.merchantId;
    if (dto.serviceId !== undefined) entity.serviceId = dto.serviceId;
    if (dto.baseUrl !== undefined) entity.baseUrl = dto.baseUrl;
    if (dto.isActive !== undefined) entity.isActive = dto.isActive;
    if (dto.secret !== undefined) {
      entity.secretEncrypted = encryptSecret(dto.secret, this.encryptionKey());
    }
    const saved = await this.providerConfigs.save(entity);
    return this.withoutSecret(saved);
  }

  async providerStatus(provider: PaymentProvider) {
    const entity = await this.providerConfigs.findOne({
      where: { provider },
      select: {
        id: true,
        provider: true,
        merchantId: true,
        serviceId: true,
        isActive: true,
        baseUrl: true,
        secretEncrypted: true,
      },
    });
    return {
      provider,
      merchantId: entity?.merchantId ?? null,
      serviceId: entity?.serviceId ?? null,
      baseUrl: entity?.baseUrl ?? null,
      isActive: entity?.isActive ?? false,
      hasSecret: Boolean(entity?.secretEncrypted),
      configured: Boolean(
        entity?.isActive &&
        entity.secretEncrypted &&
        entity.merchantId &&
        (provider !== PaymentProvider.CLICK || entity.serviceId),
      ),
    };
  }

  async getProviderSecret(provider: PaymentProvider): Promise<string | null> {
    return (await this.getProviderCredentials(provider))?.secret ?? null;
  }

  async getProviderCredentials(provider: PaymentProvider): Promise<{
    merchantId: string | null;
    serviceId: string | null;
    secret: string;
  } | null> {
    const entity = await this.providerConfigs.findOne({
      where: { provider, isActive: true },
      select: {
        id: true,
        merchantId: true,
        serviceId: true,
        secretEncrypted: true,
      },
    });
    if (!entity?.secretEncrypted) return null;
    return {
      merchantId: entity.merchantId,
      serviceId: entity.serviceId,
      secret: decryptSecret(entity.secretEncrypted, this.encryptionKey()),
    };
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

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
  publicPaymentStatus,
  UpsertProviderConfigDto,
} from '@app/common';
import { Payment } from './entities/payment.entity';
import { ProviderConfig } from './entities/provider-config.entity';
import { paymentAtomic, validReference } from './payment-atomic';

/**
 * Provayderning hosted checkout sahifasi. Admin `baseUrl` kiritsa (masalan
 * Payme sandbox `https://test.paycom.uz`) o'sha ishlatiladi, aks holda shu
 * production manzillari. Callback host'i bilan bir xil bo'lishi shart emas.
 */
const CHECKOUT_BASE_URL: Record<PaymentProvider, string> = {
  [PaymentProvider.PAYME]: 'https://checkout.paycom.uz',
  [PaymentProvider.CLICK]: 'https://my.click.uz/services/pay',
};

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
      return this.toResult(existing, await this.checkoutUrl(existing, dto));
    }

    const payment = this.payments.create({
      salesOrderId: dto.salesOrderId,
      provider: dto.provider,
      amount: dto.amount,
      // Bazada CREATED bo'lib qoladi — PENDING "provayderda tranzaksiya
      // boshlandi" degani va shu buyurtmada boshqa provayderni bloklaydi
      // (click/payme dagi `competing` tekshiruvi). Mijozga esa
      // `publicPaymentStatus()` orqali PENDING bo'lib chiqadi.
      status: PaymentStatus.CREATED,
      externalTxnId: null,
      paidAt: null,
    });
    const saved = await this.payments.save(payment);
    return this.toResult(saved, await this.checkoutUrl(saved, dto));
  }

  /**
   * Buyurtma bekor qilinganda yakunlanmagan (CREATED/PENDING) to'lov
   * yozuvlarini yopadi. Aks holda xaridor allaqachon bekor qilingan
   * buyurtmani provayder sahifasida to'lab yuborishi mumkin edi: Payme
   * `PerformTransaction` va Click `Complete` faqat CREATED/PENDING holatni
   * qabul qiladi, CANCELLED esa ularni rad etadi.
   */
  async cancelOpen(data: {
    salesOrderId: string;
    reason?: string;
  }): Promise<{ salesOrderId: string; cancelled: number }> {
    if (!validReference(data?.salesOrderId))
      throw new BadRequestException('Buyurtma ID noto‘g‘ri');
    return paymentAtomic(this.payments, (manager) =>
      new PaymentService(
        manager.getRepository(Payment),
        manager.getRepository(ProviderConfig),
        this.config,
      ).cancelOpenLocked(data.salesOrderId),
    );
  }

  private async cancelOpenLocked(
    salesOrderId: string,
  ): Promise<{ salesOrderId: string; cancelled: number }> {
    const rows = await this.payments.find({ where: { salesOrderId } });
    if (rows.some((payment) => payment.status === PaymentStatus.PAID))
      throw new BadRequestException(
        'Buyurtma to‘langan — bekor qilish o‘rniga refund kerak',
      );
    const open = rows.filter((payment) =>
      [PaymentStatus.CREATED, PaymentStatus.PENDING].includes(payment.status),
    );
    for (const payment of open) payment.status = PaymentStatus.CANCELLED;
    if (open.length) await this.payments.save(open);
    return { salesOrderId, cancelled: open.length };
  }

  /**
   * Xaridor yo'naltiriladigan provayder sahifasi. Provayder kaliti yoki
   * merchant/service ID hali kiritilmagan bo'lsa `null` — frontend bunda
   * "to'lov hozircha mavjud emas" deb ko'rsatadi, 500 bermaydi.
   */
  private async checkoutUrl(
    payment: Payment,
    dto: CreatePaymentDto,
  ): Promise<string | null> {
    if (
      ![PaymentStatus.CREATED, PaymentStatus.PENDING].includes(payment.status)
    )
      return null;
    const config = await this.providerConfigs.findOne({
      where: { provider: payment.provider, isActive: true },
      select: {
        id: true,
        provider: true,
        merchantId: true,
        serviceId: true,
        baseUrl: true,
      },
    });
    if (!config?.merchantId) return null;
    const base = (
      config.baseUrl ?? CHECKOUT_BASE_URL[payment.provider]
    ).replace(/\/+$/, '');
    return payment.provider === PaymentProvider.PAYME
      ? this.paymeCheckoutUrl(base, config.merchantId, payment, dto.returnUrl)
      : this.clickCheckoutUrl(base, config, payment, dto.returnUrl);
  }

  /**
   * Payme checkout: `<base>/<base64(m=..;ac.order_id=..;a=..;c=..)>`.
   * `ac.order_id` — payment ID (callback ham shu bo'yicha qidiradi),
   * `a` — tiyin, `c` — qaytish manzili.
   */
  private paymeCheckoutUrl(
    base: string,
    merchantId: string,
    payment: Payment,
    returnUrl?: string,
  ): string {
    const params = [
      `m=${merchantId}`,
      `ac.order_id=${payment.id}`,
      `a=${Math.round(Number(payment.amount) * 100)}`,
    ];
    if (returnUrl) params.push(`c=${returnUrl}`);
    return `${base}/${Buffer.from(params.join(';'), 'utf8').toString('base64')}`;
  }

  /** Click checkout: summa so'mda, `transaction_param` — payment ID. */
  private clickCheckoutUrl(
    base: string,
    config: ProviderConfig,
    payment: Payment,
    returnUrl?: string,
  ): string | null {
    if (!config.serviceId) return null;
    const url = new URL(base);
    url.searchParams.set('service_id', config.serviceId);
    url.searchParams.set('merchant_id', String(config.merchantId));
    url.searchParams.set('amount', Number(payment.amount).toFixed(2));
    url.searchParams.set('transaction_param', payment.id);
    if (returnUrl) url.searchParams.set('return_url', returnUrl);
    return url.toString();
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

  private toResult(
    payment: Payment,
    redirectUrl: string | null = null,
  ): PaymentResultDto {
    return {
      id: payment.id,
      salesOrderId: payment.salesOrderId,
      provider: payment.provider,
      amount: Number(payment.amount),
      status: publicPaymentStatus(payment.status),
      createdAt: payment.createdAt,
      redirectUrl,
    };
  }

  private withoutSecret(
    entity: ProviderConfig,
  ): Omit<ProviderConfig, 'secretEncrypted'> {
    const { secretEncrypted: _secret, ...safe } = entity;
    return safe;
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  calculatePrice,
  DeliveryDisplayMode,
  DeliveryKind,
  deliveryView,
  ElchiTariff,
  ElchiTariffDto,
  elchiTariffFor,
  evaluatePrice,
  marketCheck,
  maxSalePriceFor,
  PriceDecisionDto,
  PricePolicyDto,
  PriceStatus,
  PricingParams,
  recommendedAffiliateFee,
  RmqClient,
} from '@app/common';
import { Product } from './entities/product.entity';
import {
  ElchiTariffEntity,
  PriceDecision,
  PricePolicy,
  PricePolicyScope,
} from './entities/pricing.entity';

const PARAM_KEYS = [
  'kSale70',
  'kSale100',
  'targetMargin',
  'taxRate',
  'paymentRate',
  'callCenterFee',
  'affiliateCoef',
  'adCost',
  'markupCapPercent',
  'deliveryMode',
  'visibleCenter',
  'visibleAddress',
] as const satisfies ReadonlyArray<keyof PricingParams>;

/** Bir so‘rov ichida qayta o‘qilmaydigan sozlamalar: hamma daraja va joriy tarif. */
export interface PricingContext {
  policies: PricePolicy[];
  tariff: ElchiTariff;
}

/** Mahsulot narxi bo‘yicha offer maydonlari (BE-11 shartnomasi `CatalogOfferSnapshot`). */
export interface OfferPricing {
  approvedPrice: number | null;
  maxSalePrice: number | null;
  centerDeliveryFee: number;
  addressDeliveryFee: number;
}

/**
 * BE-09: narx kalkulyatori xizmati (TZ 2-bo‘lim, 6.13). Hisob — `@app/common` `price-calculator` (sof funksiyalar);
 * bu yerda sozlamalar darajasi, Elchi tarifi, narx qarori va offer maydonlari.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(PricePolicy)
    private readonly policies: Repository<PricePolicy>,
    @InjectRepository(ElchiTariffEntity)
    private readonly tariffs: Repository<ElchiTariffEntity>,
    @InjectRepository(PriceDecision)
    private readonly decisions: Repository<PriceDecision>,
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications: ClientProxy,
  ) {}

  async context(now = new Date()): Promise<PricingContext> {
    const [policies, tariff] = await Promise.all([
      this.policies.find({ where: { isDeleted: false } }),
      this.currentTariff(now),
    ]);
    return { policies, tariff };
  }

  /** Global → kategoriya → mahsulot; bo‘sh maydon yuqori darajadan (TZ 2.4 «Sozlama tartibi»). */
  paramsFor(
    product: Pick<Product, 'id' | 'categoryId'>,
    ctx: PricingContext,
  ): PricingParams {
    const find = (scope: PricePolicyScope, id: string | null) =>
      ctx.policies.find(
        (p) => p.scope === scope && (p.scopeId ?? null) === (id ?? null),
      );
    const layers = [
      find(PricePolicyScope.GLOBAL, null),
      product.categoryId
        ? find(PricePolicyScope.CATEGORY, String(product.categoryId))
        : undefined,
      find(PricePolicyScope.PRODUCT, String(product.id)),
    ];
    if (!layers[0])
      throw new ConflictException(
        'Narx kalkulyatorining global sozlamasi yo‘q',
      );
    const params = {} as Record<string, unknown>;
    for (const layer of layers)
      if (layer)
        for (const key of PARAM_KEYS)
          if (layer[key] !== null && layer[key] !== undefined)
            params[key] = layer[key];
    return params as unknown as PricingParams;
  }

  /** Mahsulot uchun to‘liq hisob: tavsiya, chegaralar, yetkazish, kiritilgan (yoki tasdiqlangan) narx holati. */
  async calculate(
    productId: string,
    query: { price?: number; affiliateFee?: number } = {},
  ) {
    const product = await this.product(productId);
    const ctx = await this.context();
    return this.view(product, ctx, query);
  }

  /** NRX-6: narxni tasdiqlash. Qizil — saqlanmaydi; to‘q sariq — faqat sabab bilan, superadminga xabar. */
  async decide(productId: string, actorId: string, dto: PriceDecisionDto) {
    const product = await this.product(productId);
    const ctx = await this.context();
    const affiliateFee = dto.affiliateFee ?? product.affiliateFee;
    if (affiliateFee == null)
      throw new BadRequestException(
        'Sotuvchi haqi kiritilmagan (mahsulotda ham yo‘q)',
      );
    const view = this.view(product, ctx, { price: dto.price, affiliateFee });
    const evaluation = view.evaluation!;
    if (evaluation.status === PriceStatus.RED)
      throw new BadRequestException({
        message:
          'Qizil narx: har bir buyurtma sotilsa ham platforma zarar ko‘radi — saqlanmaydi',
        details: [
          {
            field: 'price',
            error: `Eng kam narx ${view.calculation.orangeFrom}`,
          },
        ],
      });
    const reason = dto.reason?.trim() || null;
    if (evaluation.status === PriceStatus.ORANGE && !reason)
      throw new BadRequestException(
        'To‘q sariq narx: sabab majburiy (platforma yoki sotuvchi zarar ko‘radi)',
      );

    const decision = await this.decisions.manager.transaction(async (m) => {
      const saved = await m.getRepository(PriceDecision).save(
        m.getRepository(PriceDecision).create({
          productId: String(product.id),
          price: dto.price,
          basePrice: product.basePrice!,
          affiliateFee,
          recommended: view.calculation.recommended,
          status: evaluation.status,
          reason,
          calculation: {
            params: view.params,
            calculation: view.calculation,
            evaluation,
            tariff: ctx.tariff,
          },
          decidedBy: String(actorId),
        }),
      );
      await m.getRepository(Product).update(
        { id: product.id },
        {
          approvedPrice: dto.price,
          priceStatus: evaluation.status,
          affiliateFee,
          // Eski storefront va qidiruv `price` dan o‘qiydi — tasdiqlangan narx bilan bir xil
          price: dto.price,
        },
      );
      return saved;
    });

    if (evaluation.status === PriceStatus.ORANGE)
      await this.emitOrange(product, decision);
    return { decision: this.decisionView(decision), ...view };
  }

  async history(productId: string) {
    await this.product(productId);
    const rows = await this.decisions.find({
      where: { productId: String(productId), isDeleted: false },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return rows.map((row) => this.decisionView(row));
  }

  /** NRX-5: raqobatchida mijoz jami bilan solishtirish; summa mahsulotda saqlanadi (ustama chegarasi uchun, NRX-4). */
  async marketCheck(productId: string, competitorTotal: number) {
    const product = await this.product(productId);
    const ctx = await this.context();
    const params = this.paramsFor(product, ctx);
    // sotuvchi haqi — hisob ekrani bilan bir xil (mahsulotda bo‘lmasa — tavsiya)
    const calc = calculatePrice(params, ctx.tariff, {
      ...this.inputs(product),
      affiliateFee: product.affiliateFee ?? recommendedAffiliateFee(params),
    });
    await this.products.update(
      { id: product.id },
      { marketTotal: competitorTotal },
    );
    return marketCheck(params, calc, competitorTotal);
  }

  /** Sozlama darajasi (o‘qish). */
  async getPolicy(scope: PricePolicyScope, scopeId: string | null) {
    const row = await this.policies.findOne({
      where: {
        scope,
        scopeId: scopeId === null ? (null as never) : scopeId,
        isDeleted: false,
      },
    });
    return this.policyView(row, scope, scopeId);
  }

  /** ADM-2: sozlamani o‘zgartirish. Global darajada bo‘sh qiymat yo‘q; ko‘rinadigan yetkazish tarifdan oshmaydi. */
  async setPolicy(
    scope: PricePolicyScope,
    scopeId: string | null,
    dto: PricePolicyDto,
    actorId: string,
  ) {
    if (scope === PricePolicyScope.PRODUCT) await this.product(scopeId!);
    const existing = await this.policies.findOne({
      where: {
        scope,
        scopeId: scopeId === null ? (null as never) : scopeId,
        isDeleted: false,
      },
    });
    const row =
      existing ?? this.policies.create({ scope, scopeId: scopeId ?? null });
    const before = existing ? this.policyView(existing, scope, scopeId) : null;
    for (const key of PARAM_KEYS)
      if (dto[key] !== undefined)
        (row as unknown as Record<string, unknown>)[key] = dto[key];
    if (scope === PricePolicyScope.GLOBAL)
      for (const key of PARAM_KEYS)
        if (row[key] === null || row[key] === undefined)
          throw new BadRequestException(
            `Global sozlamada ${key} bo‘sh bo‘lmaydi`,
          );
    row.updatedBy = String(actorId);
    const tax = Number(row.taxRate ?? 0);
    const pay = Number(row.paymentRate ?? 0);
    if ((row.taxRate != null || row.paymentRate != null) && tax + pay >= 0.5)
      throw new BadRequestException(
        'Soliq va to‘lov foizlari yig‘indisi 50% dan kam bo‘lishi kerak',
      );
    await this.assertVisibleWithinTariff(row, scope, scopeId, dto);
    const saved = await this.policies.save(row);
    return { before, after: this.policyView(saved, scope, scopeId) };
  }

  async listTariffs() {
    return this.tariffs.find({
      where: { isDeleted: false },
      order: { effectiveFrom: 'DESC', id: 'DESC' },
    });
  }

  /** NRX-7: yangi tarif qo‘shiladi (eskisi o‘zgarmaydi); buyurtmalar o‘z nusxasini saqlaydi (BE-18, NRX-10). */
  async addTariff(dto: ElchiTariffDto, actorId: string) {
    const effectiveFrom = dto.effectiveFrom
      ? new Date(dto.effectiveFrom)
      : new Date();
    if (Number.isNaN(effectiveFrom.getTime()))
      throw new BadRequestException('effectiveFrom noto‘g‘ri');
    return this.tariffs.save(
      this.tariffs.create({
        centerBase: dto.centerBase,
        baseWeightGrams: dto.baseWeightGrams,
        perExtraKg: dto.perExtraKg,
        addressExtra: dto.addressExtra,
        effectiveFrom,
        createdBy: String(actorId),
      }),
    );
  }

  /**
   * Offer maydonlari: tasdiqlangan narx, eng katta narx (NRX-4), ko‘rinadigan yetkazish (bir dona). Tasdiqlangan narx
   * joriy sozlama bilan qayta baholanadi: asosi (B, A, og‘irlik, rejim, K, tarif) o‘zgarib holati yomonlashgan yoki
   * qizil bo‘lsa — narx tasdiqlanmagan hisoblanadi, offer sotuvdan tushadi (yangi qaror kerak).
   */
  offerPricing(product: Product, ctx: PricingContext): OfferPricing {
    if (product.weightGrams == null || product.basePrice == null)
      return {
        approvedPrice: null,
        maxSalePrice: null,
        centerDeliveryFee: 0,
        addressDeliveryFee: 0,
      };
    const params = this.paramsFor(product, ctx);
    const delivery = deliveryView(params, ctx.tariff, product.weightGrams);
    const approved = this.isApprovalCurrent(product, params, ctx)
      ? product.approvedPrice
      : null;
    return {
      approvedPrice: approved,
      maxSalePrice:
        approved == null
          ? null
          : maxSalePriceFor(params, approved, delivery, product.marketTotal),
      centerDeliveryFee: delivery.visibleCenter,
      addressDeliveryFee: delivery.visibleAddress,
    };
  }

  /**
   * Ko‘rinadigan yetkazish `quantity` dona uchun (BUY-4, FE-09): jami og‘irlik bo‘yicha Elchi tarifi, tovar narxida
   * yashirilgan qism (bir dona asosida) ayirilgan; bepul rejimda — 0; tarifdan oshmaydi.
   */
  async quote(productId: string, quantity: number, whereDeliver: string) {
    const product = await this.product(productId);
    return this.quoteFor(product, await this.context(), quantity, whereDeliver);
  }

  /**
   * BE-18: buyurtma narx nusxasi (NRX-10) — tasdiqlangan narxdagi to‘rt qator taqsimoti (TZ 2.2) va `quantity` dona
   * uchun yetkazish (BUY-4). Tasdiq joriy bo‘lmasa (`offerPricing` qoidasi) — `approvedPrice` null, taqsimot tavsiya
   * narxda (buyurtma yaratilmaydi).
   */
  async orderPricing(product: Product, quantity: number, whereDeliver: string) {
    const ctx = await this.context();
    const params = this.paramsFor(product, ctx);
    const calculation = calculatePrice(
      params,
      ctx.tariff,
      this.inputs(product),
    );
    const approvedPrice = this.isApprovalCurrent(product, params, ctx)
      ? product.approvedPrice
      : null;
    const { split } = evaluatePrice(
      params,
      calculation,
      approvedPrice ?? calculation.recommended,
    );
    const delivery = this.quoteFor(product, ctx, quantity, whereDeliver);
    return {
      basePrice: calculation.basePrice,
      recommendedPrice: calculation.recommended,
      approvedPrice,
      affiliateFee: split.affiliate,
      callCenterFee: split.callCenter,
      hiddenDelivery: split.hiddenDelivery,
      platformService: split.platformService,
      delivery: {
        mode: params.deliveryMode,
        shown: delivery.deliveryFee,
        elchiTariff: delivery.elchiTariff,
      },
    };
  }

  /**
   * BE-34: ko‘p tovarli posilka yetkazishi [taklif]. Elchi tarifi — jami og‘irlik bo‘yicha (ELC-6). Mijozga ko‘rinadigan
   * summa — bitta tovar qoidasi (`quoteFor`) butun posilkaga: bir dona birlik tarifi eng katta «bepul emas» tovardan;
   * hammasi «bepul» bo‘lsa — 0. Bitta tovarda natija `quoteFor` bilan bir xil.
   */
  async combinedDelivery(
    entries: Array<{ product: Product; quantity: number }>,
    whereDeliver: string,
  ): Promise<{
    mode: DeliveryDisplayMode;
    shown: number;
    elchiTariff: number;
  }> {
    const ctx = await this.context();
    // har qator bitta tovar qoidalari bilan tekshiriladi (miqdor, og‘irlik, bazaviy narx)
    for (const { product, quantity } of entries)
      this.quoteFor(product, ctx, quantity, whereDeliver);
    const kind =
      whereDeliver === DeliveryKind.ADDRESS
        ? DeliveryKind.ADDRESS
        : DeliveryKind.CENTER;
    const weight = entries.reduce(
      (sum, { product, quantity }) => sum + product.weightGrams! * quantity,
      0,
    );
    const tariff = elchiTariffFor(ctx.tariff, weight, kind);
    const paid = entries
      .map(({ product }) => {
        const params = this.paramsFor(product, ctx);
        const unit = deliveryView(params, ctx.tariff, product.weightGrams!);
        return {
          mode: params.deliveryMode,
          visible:
            kind === DeliveryKind.ADDRESS
              ? unit.visibleAddress
              : unit.visibleCenter,
          unitTariff:
            kind === DeliveryKind.ADDRESS
              ? unit.tariffAddress
              : unit.tariffCenter,
        };
      })
      .filter((line) => line.mode !== DeliveryDisplayMode.FREE)
      .sort((a, b) => b.unitTariff - a.unitTariff);
    if (!paid.length)
      return { mode: DeliveryDisplayMode.FREE, shown: 0, elchiTariff: tariff };
    const ref = paid[0];
    return {
      mode: ref.mode,
      shown: Math.min(tariff, ref.visible + (tariff - ref.unitTariff)),
      elchiTariff: tariff,
    };
  }

  private quoteFor(
    product: Product,
    ctx: PricingContext,
    quantity: number,
    whereDeliver: string,
  ) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000)
      throw new BadRequestException('Miqdor 1 dan 1000 gacha butun son');
    if (product.weightGrams == null || product.basePrice == null)
      throw new BadRequestException(
        'Narx hisoblash uchun bazaviy narx va og‘irlik kerak (BE-07)',
      );
    const params = this.paramsFor(product, ctx);
    const unit = deliveryView(params, ctx.tariff, product.weightGrams!);
    const kind =
      whereDeliver === DeliveryKind.ADDRESS
        ? DeliveryKind.ADDRESS
        : DeliveryKind.CENTER;
    const tariff = elchiTariffFor(
      ctx.tariff,
      product.weightGrams! * quantity,
      kind,
    );
    const visibleUnit =
      kind === DeliveryKind.ADDRESS ? unit.visibleAddress : unit.visibleCenter;
    const unitTariff =
      kind === DeliveryKind.ADDRESS ? unit.tariffAddress : unit.tariffCenter;
    // Bir donadagi ko‘rinadigan summa + og‘irlik oshgani uchun tarif farqi; «bepul» e’lon qilinganda keyin ham 0 (TZ 2.4)
    const deliveryFee =
      params.deliveryMode === DeliveryDisplayMode.FREE
        ? 0
        : Math.min(tariff, visibleUnit + (tariff - unitTariff));
    return { deliveryFee, elchiTariff: tariff };
  }

  private view(
    product: Product,
    ctx: PricingContext,
    query: { price?: number; affiliateFee?: number },
  ) {
    const params = this.paramsFor(product, ctx);
    const affiliateFee =
      query.affiliateFee ??
      product.affiliateFee ??
      recommendedAffiliateFee(params);
    const calculation = calculatePrice(params, ctx.tariff, {
      ...this.inputs(product),
      affiliateFee,
    });
    const price =
      query.price ?? product.approvedPrice ?? calculation.recommended;
    const evaluation = evaluatePrice(params, calculation, price);
    return {
      productId: String(product.id),
      /** Tasdiq joriymi: asosi o‘zgarib holati yomonlashgan bo‘lsa — false (offer sotuvdan tushgan, yangi qaror kerak). */
      approvalCurrent: this.isApprovalCurrent(product, params, ctx),
      params,
      tariff: ctx.tariff,
      recommendedAffiliateFee: recommendedAffiliateFee(params),
      calculation,
      evaluation,
      approvedPrice: product.approvedPrice,
      priceStatus: product.priceStatus,
      marketTotal: product.marketTotal,
      maxSalePrice:
        product.approvedPrice == null
          ? null
          : maxSalePriceFor(
              params,
              product.approvedPrice,
              calculation.delivery,
              product.marketTotal,
            ),
    };
  }

  /**
   * Tasdiq joriymi: joriy sozlamada qizil bo‘lsa yoki yangi zarar paydo bo‘lsa (yashil/sariq qaror endi to‘q sariq) —
   * yo‘q. Yashil → sariq (hech kim zarar ko‘rmaydi, masalan M oshganda) tasdiqni bekor qilmaydi.
   */
  /** BE-27: tasdiqlangan narx hozir ham amaldami (moderatsiya hisoblagichi uchun). */
  approvalCurrent(product: Product, ctx: PricingContext): boolean {
    return this.isApprovalCurrent(product, this.paramsFor(product, ctx), ctx);
  }

  private isApprovalCurrent(
    product: Product,
    params: PricingParams,
    ctx: PricingContext,
  ): boolean {
    if (product.approvedPrice == null || !product.priceStatus) return false;
    if (product.basePrice == null || !product.weightGrams) return false;
    const now = evaluatePrice(
      params,
      calculatePrice(params, ctx.tariff, {
        basePrice: product.basePrice,
        affiliateFee: product.affiliateFee ?? 0,
        weightGrams: product.weightGrams,
      }),
      product.approvedPrice,
    ).status;
    if (now === PriceStatus.RED) return false;
    const lossNow = now === PriceStatus.ORANGE;
    const lossApproved = product.priceStatus === PriceStatus.ORANGE;
    return !lossNow || lossApproved;
  }

  private inputs(product: Product) {
    if (product.basePrice == null || !product.weightGrams)
      throw new BadRequestException(
        'Narx hisoblash uchun bazaviy narx va og‘irlik kerak (BE-07)',
      );
    return {
      basePrice: product.basePrice,
      affiliateFee: product.affiliateFee ?? 0,
      weightGrams: product.weightGrams,
    };
  }

  private async product(productId: string): Promise<Product> {
    if (!/^\d+$/.test(String(productId ?? '')))
      throw new NotFoundException('Mahsulot topilmadi');
    const product = await this.products.findOne({
      where: { id: String(productId), isDeleted: false },
    });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    return product;
  }

  private async currentTariff(now: Date): Promise<ElchiTariff> {
    const row = await this.tariffs.findOne({
      where: { effectiveFrom: LessThanOrEqual(now), isDeleted: false },
      order: { effectiveFrom: 'DESC', id: 'DESC' },
    });
    if (!row) throw new ConflictException('Elchi tarifi kiritilmagan');
    return {
      centerBase: row.centerBase,
      baseWeightGrams: row.baseWeightGrams,
      perExtraKg: row.perExtraKg,
      addressExtra: row.addressExtra,
    };
  }

  /** NRX-8 / TC5: ko‘rinadigan summa Elchi tarifidan oshmaydi (mahsulot darajasida — uning og‘irligi bo‘yicha). */
  private async assertVisibleWithinTariff(
    row: PricePolicy,
    scope: PricePolicyScope,
    scopeId: string | null,
    dto: PricePolicyDto,
  ) {
    if (row.visibleCenter == null && row.visibleAddress == null) return;
    const ctx = await this.context();
    const tariff = ctx.tariff;
    let weight = tariff.baseWeightGrams;
    let product: Pick<Product, 'id' | 'categoryId'> = {
      id: '0',
      categoryId: scope === PricePolicyScope.CATEGORY ? scopeId : null,
    };
    if (scope === PricePolicyScope.PRODUCT) {
      const found = await this.product(scopeId!);
      weight = found.weightGrams ?? weight;
      product = found;
    }
    const center = elchiTariffFor(tariff, weight, DeliveryKind.CENTER);
    const address = elchiTariffFor(tariff, weight, DeliveryKind.ADDRESS);
    if (row.visibleCenter != null && row.visibleCenter > center)
      throw new BadRequestException(
        `Ko‘rinadigan yetkazish (markazgacha) Elchi tarifidan (${center}) oshmaydi`,
      );
    if (row.visibleAddress != null && row.visibleAddress > address)
      throw new BadRequestException(
        `Ko‘rinadigan yetkazish (eshikkacha) Elchi tarifidan (${address}) oshmaydi`,
      );
    // Tovar narxidagi yashirilgan qism bitta (markazgacha bo‘yicha): qisman rejimda eshikkacha = eshik tarifi − shu qism
    // (sukut 50 000), aks holda eshik buyurtmasida platforma zarar ko‘radi yoki mijoz tarifdan ortiq to‘laydi
    if (dto.visibleAddress != null) {
      const others = ctx.policies.filter(
        (p) =>
          !(
            p.scope === row.scope &&
            (p.scopeId ?? null) === (row.scopeId ?? null)
          ),
      );
      const params = this.paramsFor(product, {
        ...ctx,
        policies: [...others, row],
      });
      const view = deliveryView(params, tariff, weight);
      if (
        params.deliveryMode === DeliveryDisplayMode.PARTIAL &&
        dto.visibleAddress !== view.visibleAddress
      )
        throw new BadRequestException(
          `Eshikkacha ko‘rinadigan summa markazgacha + eshik qo‘shimchasi bo‘lishi kerak: ${view.visibleAddress}`,
        );
    }
  }

  private policyView(
    row: PricePolicy | null,
    scope: PricePolicyScope,
    scopeId: string | null,
  ) {
    const values = Object.fromEntries(
      PARAM_KEYS.map((key) => [key, row?.[key] ?? null]),
    );
    return {
      scope,
      scopeId,
      ...values,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  private decisionView(row: PriceDecision) {
    return {
      id: String(row.id),
      productId: String(row.productId),
      price: row.price,
      basePrice: row.basePrice,
      affiliateFee: row.affiliateFee,
      recommended: row.recommended,
      status: row.status,
      reason: row.reason,
      decidedBy: String(row.decidedBy),
      createdAt: row.createdAt,
    };
  }

  private async emitOrange(product: Product, decision: PriceDecision) {
    try {
      await firstValueFrom(
        this.notifications.emit('price.decision.orange', {
          productId: String(product.id),
          productName: product.name,
          price: decision.price,
          recommended: decision.recommended,
          reason: decision.reason,
          decidedBy: decision.decidedBy,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `To‘q sariq narx xabari yuborilmadi (${product.id}): ${(error as Error).message}`,
      );
    }
  }
}

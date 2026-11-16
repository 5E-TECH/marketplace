import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DataSource, In, IsNull, Not } from 'typeorm';
import {
  LeadAddressDto,
  LeadAddressResolution,
  LeadErrorCode,
  RmqClient,
  sendRpc,
  UpdateLeadAddressDto,
} from '@app/common';
import { Lead, LeadHistory } from './entities';

export type ResolvedLeadAddress = Extract<LeadAddressResolution, { ok: true }>;

/** Manzil maydoni → lid tarixidagi `field` (ustun nomi). */
const ADDRESS_FIELDS = {
  regionSoato: 'region_soato',
  districtSoato: 'district_soato',
  addressLine: 'address_line',
  whereDeliver: 'where_deliver',
} as const;
type AddressField = keyof typeof ADDRESS_FIELDS;

/**
 * Mijoz manzili (BE-38; OPR-4, LID-2). Qoidalar:
 * - viloyat va tuman Elchi geo keshida bo‘lishi, tuman shu viloyatga tegishli bo‘lishi kerak — aks holda 400, maydon nomi bilan;
 * - operator saqlashi — tasdiq; tuzatilgan har maydonning eski va yangi qiymati `lead_history` ga yoziladi;
 * - manzil tasdiqlanmagan lid «Tasdiqlandi» bo‘lmaydi (`assertConfirmable`, BE-13 chaqiradi).
 * Lidni kim tahrirlay olishi (bron egasi, holat) — BE-13 navbat qoidalari, bu yerda emas.
 */
@Injectable()
export class LeadAddressService {
  constructor(
    private readonly db: DataSource,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
  ) {}

  /** Tekshiradi va nomlarni qaytaradi; xato — 400 (`details[].field`). BE-12 ham shuni ishlatadi. */
  async resolve(input: {
    regionSoato: string;
    districtSoato: string;
  }): Promise<ResolvedLeadAddress> {
    const result = await sendRpc<LeadAddressResolution>(
      this.integration,
      { cmd: 'integration.geo.resolve-address' },
      { regionSoato: input.regionSoato, districtSoato: input.districtSoato },
    );
    if (!result.ok) throw new BadRequestException({ message: [result.error] });
    return result;
  }

  /** PATCH /operator/leads/:id/address (gateway ulanishi BE-13 da, javob — lid kartasi). */
  async confirmByOperator(
    leadId: string,
    operatorId: string,
    address: UpdateLeadAddressDto,
  ): Promise<LeadAddressDto> {
    // Geo tekshiruv tranzaksiyadan oldin: RPC paytida lid qatori qulflanmaydi.
    const resolved = await this.resolve(address);
    return this.db.transaction(async (manager) => {
      const leads = manager.getRepository(Lead);
      const history = manager.getRepository(LeadHistory);
      const lead = await leads.findOne({
        where: { id: leadId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lead) throw new NotFoundException('Lid topilmadi');

      const now = new Date();
      const base = {
        leadId,
        fromStatus: lead.status,
        toStatus: lead.status,
        actorId: operatorId,
      };
      const changed = (Object.keys(ADDRESS_FIELDS) as AddressField[]).filter(
        (field) => (lead[field] ?? null) !== address[field],
      );
      await history.save([
        ...changed.map((field) =>
          history.create({
            ...base,
            field: ADDRESS_FIELDS[field],
            oldValue: { value: lead[field] ?? null },
            newValue: { value: address[field] },
            note: 'Operator manzilni tuzatdi',
          }),
        ),
        history.create({
          ...base,
          field: 'address_confirmed_at',
          oldValue: lead.addressConfirmedAt
            ? { value: lead.addressConfirmedAt.toISOString() }
            : null,
          newValue: { value: now.toISOString() },
          note: 'Operator manzilni tasdiqladi',
        }),
      ]);

      lead.regionSoato = address.regionSoato;
      lead.districtSoato = address.districtSoato;
      lead.addressLine = address.addressLine;
      lead.whereDeliver = address.whereDeliver;
      lead.addressConfirmedBy = operatorId;
      lead.addressConfirmedAt = now;
      await leads.save(lead);

      const edits = await history.count({
        where: {
          leadId,
          field: In(Object.values(ADDRESS_FIELDS)),
          actorId: Not(IsNull()),
        },
      });
      return {
        regionSoato: resolved.regionSoato,
        regionName: resolved.regionName,
        districtSoato: resolved.districtSoato,
        districtName: resolved.districtName,
        addressLine: address.addressLine,
        whereDeliver: address.whereDeliver,
        confirmedAt: now.toISOString(),
        editedByOperator: edits > 0,
      };
    });
  }

  /** «Tasdiqlandi» dan oldin (BE-13): manzil tasdiqlanmagan bo‘lsa 400 ADDRESS_NOT_CONFIRMED. */
  assertConfirmable(lead: Pick<Lead, 'addressConfirmedAt'>): void {
    if (!lead.addressConfirmedAt)
      throw new BadRequestException({
        message: 'Manzil tasdiqlanmagan: avval mijoz manzilini tasdiqlang',
        errorCode: LeadErrorCode.ADDRESS_NOT_CONFIRMED,
      });
  }
}

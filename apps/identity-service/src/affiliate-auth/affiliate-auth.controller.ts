import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AcceptAgreementDto,
  AFFILIATE_AUTH_RPC,
  EnsureWholesalerUserInput,
  PublishLegalDocumentDto,
  RegisterAffiliateDto,
  RpcHttpExceptionFilter,
  SendOtpDto,
  UpdateAffiliateProfileDto,
  VerifyOtpDto,
  WHOLESALER_CABINET_RPC,
  type RegisterWholesalerUserInput,
} from '@app/common';
import { AffiliateAuthService } from './affiliate-auth.service';

/** BE-06 (SOT-1): SMS kod, sotuvchi ro‘yxati, oferta matni va profil — gateway `auth/*`, `legal/*`, `affiliate/profile`. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AffiliateAuthController {
  constructor(private readonly svc: AffiliateAuthService) {}

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.OTP_SEND })
  send(@Payload() dto: SendOtpDto) {
    return this.svc.sendOtp(dto);
  }

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.OTP_VERIFY })
  verify(@Payload() dto: VerifyOtpDto) {
    return this.svc.verifyOtp(dto);
  }

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.REGISTER })
  register(@Payload() data: { dto: RegisterAffiliateDto; ip?: string | null }) {
    return this.svc.registerAffiliate(data?.dto, data?.ip ?? null);
  }

  /** BE-30: optovik ro‘yxati (shartnoma va rozilik). */
  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.REGISTER_USER })
  registerWholesaler(
    @Payload() data: { dto: RegisterWholesalerUserInput; ip?: string | null },
  ) {
    return this.svc.registerWholesaler(data?.dto, data?.ip ?? null);
  }

  /** BE-30: admin kiritgan optovikka kabinet foydalanuvchisi. */
  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.ENSURE_USER })
  ensureWholesaler(@Payload() dto: EnsureWholesalerUserInput) {
    return this.svc.ensureWholesalerUser(dto);
  }

  /** BE-30: kabinetda ro‘yxatni yakunlash — shartnoma va rozilik. */
  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.ACCEPT_DOCUMENTS })
  acceptWholesalerDocuments(
    @Payload()
    data: {
      userId: string;
      contractVersion: string;
      consentVersion: string;
      ip?: string | null;
    },
  ) {
    return this.svc.acceptWholesalerDocuments(
      String(data?.userId ?? ''),
      data,
      data?.ip ?? null,
    );
  }

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.LEGAL_GET })
  legal(@Payload() data: { type: string; version?: string }) {
    return this.svc.legalDocument(String(data?.type ?? ''), data?.version);
  }

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.LEGAL_PDF })
  legalPdf(@Payload() data: { type: string }) {
    return this.svc.legalDocumentPdf(String(data?.type ?? ''));
  }

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.LEGAL_PUBLISH })
  publish(
    @Payload()
    data: {
      type: string;
      dto: PublishLegalDocumentDto;
      actorId: string;
    },
  ) {
    return this.svc.publishLegalDocument(
      String(data?.type ?? ''),
      data?.dto,
      String(data?.actorId ?? ''),
    );
  }

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.PROFILE_GET })
  profile(@Payload() data: { userId: string }) {
    return this.svc.profile(String(data?.userId ?? ''));
  }

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.PROFILE_UPDATE })
  updateProfile(
    @Payload() data: { userId: string; dto: UpdateAffiliateProfileDto },
  ) {
    return this.svc.updateProfile(String(data?.userId ?? ''), data?.dto);
  }

  @MessagePattern({ cmd: AFFILIATE_AUTH_RPC.AGREEMENT_ACCEPT })
  accept(
    @Payload()
    data: {
      userId: string;
      dto: AcceptAgreementDto;
      ip?: string | null;
    },
  ) {
    return this.svc.acceptAgreement(
      String(data?.userId ?? ''),
      data?.dto,
      data?.ip ?? null,
    );
  }
}

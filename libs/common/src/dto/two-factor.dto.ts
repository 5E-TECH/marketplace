import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsJWT,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * BE-26 (T8: «admin va moliya uchun 2FA»): `ADMIN_2FA=on` bo‘lsa ADMIN, SUPERADMIN, FINANCE `/auth/login` dan sessiya
 * o‘rniga `{twoFactorRequired | twoFactorSetupRequired, challengeToken}` oladi; keyingi qadamlar shu token bilan.
 */
export class TwoFactorChallengeDto {
  @ApiProperty({
    description: 'Parol bosqichidan keyingi token (5 daqiqa), sessiya emas',
  })
  @IsJWT()
  challengeToken: string;
}

export class TwoFactorEnableDto extends TwoFactorChallengeDto {
  @ApiProperty({
    example: '305918',
    description: 'Authenticator ilovasidagi 6 raqam',
  })
  @Matches(/^\d{6}$/, { message: 'Kod 6 raqam' })
  code: string;
}

export class TwoFactorVerifyDto extends TwoFactorChallengeDto {
  @ApiPropertyOptional({ example: '305918' })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'Kod 6 raqam' })
  code?: string;

  @ApiPropertyOptional({
    example: 'K7QM2XPA4D',
    description: 'Telefon yo‘q bo‘lsa — bir martalik tiklash kodi',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  recoveryCode?: string;
}

export class TwoFactorSetupResultDto {
  @ApiProperty({
    example: 'JBSWY3DPEHPK3PXP',
    description: 'Qo‘lda kiritish uchun',
  })
  secret: string;
  @ApiProperty({
    example:
      'otpauth://totp/Elchi%20Marketplace%3A%2B998901234567?secret=JBSWY3DPEHPK3PXP&issuer=Elchi%20Marketplace&algorithm=SHA1&digits=6&period=30',
    description: 'QR shu matndan chiziladi',
  })
  otpauthUrl: string;
}

export class TwoFactorChallengeResultDto {
  @ApiProperty({ example: true }) twoFactorRequired: boolean;
  @ApiProperty({ example: false }) twoFactorSetupRequired: boolean;
  @ApiProperty() challengeToken: string;
}

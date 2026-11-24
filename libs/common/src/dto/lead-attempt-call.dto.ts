import { ApiProperty } from '@nestjs/swagger';

/** Yozuv holati (TEL-3): suhbatsiz qo‘ng‘iroqda yozuv kutilmaydi; MISSING — hisobotda xato. */
export enum CallRecordingState {
  NONE = 'NONE',
  LIVE = 'LIVE',
  PENDING = 'PENDING',
  READY = 'READY',
  MISSING = 'MISSING',
}

/** Urinishdagi qo‘ng‘iroq (TEL-3): boshlanish, javob, davomiylik, yozuv. */
export class LeadAttemptCallDto {
  @ApiProperty({ example: '501' }) id: string;
  @ApiProperty({ example: '2027-01-14T09:32:00.000Z' }) startedAt: string;
  @ApiProperty({ example: true }) answered: boolean;
  @ApiProperty({ nullable: true, type: Number, example: 118 })
  durationSeconds: number | null;
  @ApiProperty({ enum: CallRecordingState }) recording: CallRecordingState;
}

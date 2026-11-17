import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isLeadBigintId } from '@app/common';

/**
 * Lid API yo‘lidagi `:id` (BIGINT): noto‘g‘ri qiymat 400, bazaga yetib 500 bermaydi.
 * DTO maydonlari bilan bir qoida — `IsLeadBigintId` (lead.dto.ts).
 */
@Injectable()
export class ParseLeadIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isLeadBigintId(value))
      throw new BadRequestException('id musbat son bo‘lishi kerak');
    return value;
  }
}

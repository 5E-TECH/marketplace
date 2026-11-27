import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { IDENTITY_USER_NAMES, UserNameRow } from '../dto/user-names.dto';
import { RmqClient } from '../messaging/rmq.util';

/** Ism — ko‘rinish ma’lumoti: identity javob bermasa ro‘yxat va karta `#ID` bilan ochiladi [taklif: 1,5 s]. */
const NAMES_TIMEOUT_MS = 1_500;
/** Identity bir so‘rovda shuncha ism qaytaradi (`USER_NAMES_LIMIT`). */
const NAMES_CHUNK = 500;

/** BE-25 (FE-09, FE-26): operator, admin va sotuvchi ismi. Ism yo‘q yoki identity javob bermadi — `#ID`. */
@Injectable()
export class UserNamesClient {
  private readonly logger = new Logger(UserNamesClient.name);

  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  /**
   * Ism va rol ID bo‘yicha (hujjatlarda «Otabek N., omborchi»). Identity javob bermasa — bo‘sh (hujjat `#ID` bilan
   * chiqadi, yiqilmaydi).
   */
  async lookup(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, UserNameRow>> {
    const unique = [
      ...new Set(ids.filter((id): id is string => !!id).map(String)),
    ];
    const rows = new Map<string, UserNameRow>();
    if (unique.length)
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < unique.length; i += NAMES_CHUNK)
          chunks.push(unique.slice(i, i + NAMES_CHUNK));
        const parts = await Promise.all(
          chunks.map((ids) =>
            firstValueFrom(
              this.identity
                .send<UserNameRow[]>({ cmd: IDENTITY_USER_NAMES }, { ids })
                .pipe(timeout(NAMES_TIMEOUT_MS)),
            ),
          ),
        );
        for (const row of parts.flatMap((list) => list ?? []))
          rows.set(String(row.id), row);
      } catch (error) {
        this.logger.warn(`Ismlar olinmadi: ${(error as Error)?.message}`);
      }
    return rows;
  }

  async resolve(
    ids: Array<string | null | undefined>,
  ): Promise<(id: string) => string> {
    const rows = await this.lookup(ids);
    return (id) => rows.get(String(id))?.name || `#${id}`;
  }
}

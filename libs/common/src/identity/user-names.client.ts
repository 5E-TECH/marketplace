import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { IDENTITY_USER_NAMES, UserNameRow } from '../dto/user-names.dto';
import { RmqClient } from '../messaging/rmq.util';

/** Ism — ko‘rinish ma’lumoti: identity javob bermasa ro‘yxat va karta `#ID` bilan ochiladi [taklif: 1,5 s]. */
const NAMES_TIMEOUT_MS = 1_500;

/** BE-25 (FE-09, FE-26): operator, admin va sotuvchi ismi. Ism yo‘q yoki identity javob bermadi — `#ID`. */
@Injectable()
export class UserNamesClient {
  private readonly logger = new Logger(UserNamesClient.name);

  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  async resolve(
    ids: Array<string | null | undefined>,
  ): Promise<(id: string) => string> {
    const unique = [
      ...new Set(ids.filter((id): id is string => !!id).map(String)),
    ];
    const names = new Map<string, string>();
    if (unique.length)
      try {
        const rows = await firstValueFrom(
          this.identity
            .send<UserNameRow[]>({ cmd: IDENTITY_USER_NAMES }, { ids: unique })
            .pipe(timeout(NAMES_TIMEOUT_MS)),
        );
        for (const row of rows ?? [])
          if (row.name) names.set(String(row.id), row.name);
      } catch (error) {
        this.logger.warn(`Ismlar olinmadi: ${(error as Error)?.message}`);
      }
    return (id) => names.get(String(id)) ?? `#${id}`;
  }
}

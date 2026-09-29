import { EntityManager } from 'typeorm';
import { ReturnRequestStatus } from '@app/common';

/** Amalni bajargan foydalanuvchi — tarixga yoziladi. */
export interface ReturnActor {
  id: string;
  role: string;
}

/** Qaytarish so'rovining har holat o'tishi tarixga yoziladi (C4.2). */
export async function writeReturnHistory(
  manager: EntityManager,
  entry: {
    returnId: string;
    from: ReturnRequestStatus | null;
    to: ReturnRequestStatus;
    actor: ReturnActor;
    comment: string | null;
  },
): Promise<void> {
  await manager.query(
    `INSERT INTO checkout.return_request_history
       (return_request_id,from_status,to_status,actor_id,actor_role,comment)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      entry.returnId,
      entry.from,
      entry.to,
      entry.actor.id,
      entry.actor.role,
      entry.comment,
    ],
  );
}

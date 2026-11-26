import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ErrorCode,
  RETURN_PHOTO_MAX,
  ReturnPhotoDto,
  ReturnPhotosResultDto,
  StoredReturnPhoto,
} from '@app/common';

const ID = /^[1-9]\d{0,18}$/;

/** So‘rov rasmlari (kalitsiz) — tartib: yuklangan ketma-ketlikda. */
export async function returnPhotos(
  db: Pick<DataSource, 'query'>,
  returnId: string,
): Promise<ReturnPhotoDto[]> {
  const rows = (await db.query(
    `SELECT id::text, content_type AS "contentType", size, created_at AS "createdAt"
       FROM checkout.return_photo WHERE return_request_id = $1 ORDER BY id`,
    [returnId],
  )) as Array<{
    id: string;
    contentType: string;
    size: number;
    createdAt: Date;
  }>;
  return rows.map((row) => ({
    id: row.id,
    contentType: row.contentType,
    size: Number(row.size),
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

/**
 * BE-25 (FE-26): xodim kiritgan qaytarish so‘roviga mijoz rasmlari — faqat qaror berilmagan so‘rovga, 3 tagacha.
 * Fayllar file-service dagi yopiq joyda; bu yerda faqat kaliti. Ko‘rish — imzolangan havola (gateway).
 */
@Injectable()
export class ReturnPhotoService {
  constructor(private readonly dataSource: DataSource) {}

  /** Fayllar saqlanishidan oldin: ochiq so‘rov bormi va joy yetadimi. */
  async check(input: {
    orderId: string;
    count: number;
  }): Promise<{ returnId: string }> {
    const returnId = await this.openRequest(
      this.dataSource.manager,
      input?.orderId,
      false,
    );
    await this.assertRoom(this.dataSource.manager, returnId, input.count);
    return { returnId };
  }

  async add(input: {
    orderId: string;
    returnId: string;
    files: StoredReturnPhoto[];
    actorId: string;
  }): Promise<ReturnPhotosResultDto> {
    const files = Array.isArray(input?.files) ? input.files : [];
    if (!files.length) throw new BadRequestException('Rasm tanlanmagan');
    return this.dataSource.transaction(async (manager) => {
      const returnId = await this.openRequest(manager, input.orderId, true);
      // tekshiruvdan keyin so‘rov almashgan bo‘lsa, rasm boshqa so‘rovga tushmasin
      if (returnId !== String(input.returnId)) throw this.noOpen();
      await this.assertRoom(manager, returnId, files.length);
      for (const file of files)
        await manager.query(
          `INSERT INTO checkout.return_photo (return_request_id, object_key, content_type, size, uploaded_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            returnId,
            file.objectKey,
            file.contentType,
            file.size,
            input.actorId,
          ],
        );
      const photos = await returnPhotos(manager, returnId);
      return { returnId, count: photos.length, photos };
    });
  }

  /** Rasm kaliti — gateway imzolangan havola bo‘yicha faylni olganda. */
  async get(input: {
    photoId: string;
    /** Berilsa — rasm shu so‘rovniki bo‘lishi shart. */
    returnId?: string;
  }): Promise<{ id: string; returnId: string; objectKey: string }> {
    const photoId = String(input?.photoId ?? '');
    if (!ID.test(photoId)) throw new NotFoundException('Rasm topilmadi');
    const [row] = (await this.dataSource.query(
      `SELECT id::text, return_request_id::text AS "returnId", object_key AS "objectKey"
         FROM checkout.return_photo WHERE id = $1`,
      [photoId],
    )) as Array<{ id: string; returnId: string; objectKey: string }>;
    if (!row || (input.returnId && row.returnId !== String(input.returnId)))
      throw new NotFoundException('Rasm topilmadi');
    return row;
  }

  private async openRequest(
    manager: EntityManager,
    orderId: unknown,
    lock: boolean,
  ): Promise<string> {
    const id = String(orderId ?? '');
    if (!ID.test(id)) throw new NotFoundException('Buyurtma topilmadi');
    const [order] = (await manager.query(
      `SELECT id FROM checkout.sales_order WHERE id = $1`,
      [id],
    )) as unknown[];
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const [row] = (await manager.query(
      `SELECT id::text FROM checkout.return_request
        WHERE sales_order_id = $1 AND source = 'STAFF' AND status IN ('SUBMITTED', 'IN_REVIEW')
        ORDER BY id DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as Array<{ id: string }>;
    if (!row) throw this.noOpen();
    return row.id;
  }

  private async assertRoom(
    manager: EntityManager,
    returnId: string,
    adding: number,
  ): Promise<void> {
    const [{ total }] = (await manager.query(
      `SELECT count(*)::int AS total FROM checkout.return_photo WHERE return_request_id = $1`,
      [returnId],
    )) as Array<{ total: number }>;
    if (Number(total) + Number(adding) > RETURN_PHOTO_MAX)
      throw new ConflictException({
        message: `Bitta so‘rovga ${RETURN_PHOTO_MAX} tagacha rasm (hozir ${total} ta)`,
        errorCode: ErrorCode.INVALID_STATE,
      });
  }

  private noOpen() {
    return new ConflictException({
      message: 'Ochiq qaytarish so‘rovi yo‘q',
      errorCode: ErrorCode.INVALID_STATE,
    });
  }
}

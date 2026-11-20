import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CreativeDto,
  CreativeType,
  MAX_CREATIVES_PER_PRODUCT,
  VerifiedCreativeFile,
} from '@app/common';
import { Creative } from './entities/creative.entity';
import { Product } from './entities/product.entity';

const ID = /^[1-9]\d{0,18}$/;

/** Kreativlar kutubxonasi (BE-08, SOT-9): admin yuklaydi, offer va sotuvchi sahifasi ochiq havola bilan o‘qiydi. */
@Injectable()
export class CreativeService {
  constructor(
    @InjectRepository(Creative)
    private readonly creatives: Repository<Creative>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /** file-service tekshirgan faylni mahsulotga bog‘laydi (TC1, TC3). */
  async create(input: {
    productId: string;
    file: VerifiedCreativeFile;
    actorId: string | null;
  }): Promise<CreativeDto> {
    const productId = this.productIdOf(input?.productId);
    const file = input?.file;
    if (
      !file ||
      !Object.values(CreativeType).includes(file.type) ||
      !String(file.objectKey ?? '').startsWith(`creatives/${productId}/`)
    )
      throw new BadRequestException('Kreativ fayli noto‘g‘ri');
    return this.creatives.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Creative);
      // bir mahsulotga parallel qo‘shishda chegara buzilmasin
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `catalog-creative:${productId}`,
      ]);
      const existing = await repo.findOne({
        where: { objectKey: file.objectKey },
      });
      // takroriy tasdiq (oldingi javob yetib kelmagan) — mahsulot holatidan qat’i nazar o‘sha kreativ
      if (existing && !existing.isDeleted) return this.toDto(existing);
      if (existing)
        throw new ConflictException('Bu fayl o‘chirilgan kreativga tegishli');
      await this.requireProduct(productId);
      const count = await repo.count({
        where: { productId, isDeleted: false },
      });
      if (count >= MAX_CREATIVES_PER_PRODUCT)
        throw new ConflictException(
          `Bir mahsulotga ${MAX_CREATIVES_PER_PRODUCT} tadan ortiq kreativ bo‘lmaydi`,
        );
      const [{ next }] = (await manager.query(
        `SELECT COALESCE(MAX(position) + 1, 0)::int AS next FROM catalog.creative
          WHERE product_id = $1 AND is_deleted = FALSE`,
        [productId],
      )) as Array<{ next: number }>;
      const saved = await repo.save(
        repo.create({
          productId,
          type: file.type,
          objectKey: file.objectKey,
          url: file.url,
          mimeType: file.mimeType,
          sizeBytes: Number(file.size),
          position: next,
          createdBy:
            input.actorId && ID.test(String(input.actorId))
              ? String(input.actorId)
              : null,
        }),
      );
      return this.toDto(saved);
    });
  }

  /**
   * Fayl allaqachon kreativmi (gateway tasdiqdan oldin so‘raydi): bor — o‘sha kreativ, yo‘q — `null` (RMQ javobi
   * bo‘sh qolmasin — obyekt ichida), o‘chirilgan — 409.
   * Shunda qayta tasdiqda fayl qayta tekshirilmaydi va o‘chirilmaydi.
   */
  async find(input: {
    productId: string;
    objectKey: string;
  }): Promise<{ creative: CreativeDto | null }> {
    const productId = this.productIdOf(input?.productId);
    const objectKey = String(input?.objectKey ?? '');
    if (!objectKey.startsWith(`creatives/${productId}/`))
      return { creative: null };
    const row = await this.creatives.findOne({
      where: { objectKey, productId },
    });
    if (!row) return { creative: null };
    if (row.isDeleted)
      throw new ConflictException('Bu fayl o‘chirilgan kreativga tegishli');
    return { creative: this.toDto(row) };
  }

  async list(productId: string): Promise<CreativeDto[]> {
    const id = this.productIdOf(productId);
    await this.requireProduct(id);
    const rows = await this.creatives.find({
      where: { productId: id, isDeleted: false },
      order: { position: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => this.toDto(row));
  }

  /** O‘chiradi (offerdan chiqadi); fayl kalitini qaytaradi — gateway faylni ham o‘chiradi. */
  async delete(input: {
    productId: string;
    creativeId: string;
  }): Promise<{ id: string; objectKey: string }> {
    const productId = this.productIdOf(input?.productId);
    if (!ID.test(String(input?.creativeId ?? '')))
      throw new NotFoundException('Kreativ topilmadi');
    const row = await this.creatives.findOne({
      where: {
        id: String(input.creativeId),
        productId,
        isDeleted: false,
      },
    });
    if (!row) throw new NotFoundException('Kreativ topilmadi');
    row.isDeleted = true;
    await this.creatives.save(row);
    return { id: row.id, objectKey: row.objectKey };
  }

  /** Offer uchun (BE-11 shartnomasi): mahsulotlar bo‘yicha faol kreativlar, tartib bilan. */
  async forProducts(
    productIds: string[],
  ): Promise<
    Map<string, Array<{ id: string; type: CreativeType; url: string }>>
  > {
    const result = new Map<
      string,
      Array<{ id: string; type: CreativeType; url: string }>
    >();
    const ids = [...new Set(productIds.map(String))].filter((id) =>
      ID.test(id),
    );
    if (!ids.length) return result;
    const rows = await this.creatives.find({
      where: { productId: In(ids), isDeleted: false },
      order: { position: 'ASC', id: 'ASC' },
    });
    for (const row of rows) {
      const list = result.get(String(row.productId)) ?? [];
      list.push({ id: String(row.id), type: row.type, url: row.url });
      result.set(String(row.productId), list);
    }
    return result;
  }

  private productIdOf(productId: unknown): string {
    const id = String(productId ?? '');
    if (!ID.test(id)) throw new NotFoundException('Mahsulot topilmadi');
    return id;
  }

  private async requireProduct(productId: string): Promise<void> {
    const exists = await this.products.exists({
      where: { id: productId, isDeleted: false },
    });
    if (!exists) throw new NotFoundException('Mahsulot topilmadi');
  }

  private toDto(row: Creative): CreativeDto {
    return {
      id: String(row.id),
      productId: String(row.productId),
      type: row.type,
      url: row.url,
      mimeType: row.mimeType,
      size: Number(row.sizeBytes),
      position: row.position,
      createdAt: row.createdAt,
    };
  }
}

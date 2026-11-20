import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  CREATIVE_FOLDER,
  CreativeType,
  CreativeUploadPolicyDto,
  VerifiedCreativeFile,
} from '@app/common';

/** Yuklash imzosining amal qilish muddati [taklif]: 80 MB sekin internetda ham sig‘sin. */
const POLICY_TTL_MS = 15 * 60 * 1000;
const MB = 1024 * 1024;
const ID = /^[1-9]\d{0,18}$/;

/** Ruxsat etilgan fayl turi → kengaytma (sozlamadagi tur shu ro‘yxatda bo‘lishi kerak). */
const EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

interface TypeSettings {
  types: string[];
  maxBytes: number;
}

/**
 * Kreativ fayllari (BE-08): imzolangan POST policy bilan to‘g‘ridan-to‘g‘ri MinIO ga yuklash va yuklangandan keyin
 * tekshirish.
 *
 * POST policy (PUT emas): imzo faqat qoidalar hujjati ustidan — bucket, kalit, fayl turi, hajm oralig‘i. Yo‘l ustidan
 * emas, shuning uchun prodda `https://api…/media/<bucket>` orqali (Caddy `/media` prefiksini olib tashlaydi) ham
 * ishlaydi. Hajm chegarasi va fayl turini MinIO o‘zi tekshiradi.
 */
@Injectable()
export class CreativeFileService {
  private readonly logger = new Logger(CreativeFileService.name);
  private readonly client: Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly settings: Record<CreativeType, TypeSettings>;

  constructor(config: ConfigService) {
    this.client = new Client({
      endPoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: Number(config.getOrThrow<number>('MINIO_PORT')),
      useSSL: config.get<boolean>('MINIO_USE_SSL', false),
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
      // imzo hisobi uchun mintaqa — tarmoq orqali so‘ralmasin
      region: config.get<string>('MINIO_REGION', 'us-east-1'),
    });
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    this.publicBaseUrl = config
      .getOrThrow<string>('MINIO_PUBLIC_URL')
      .replace(/\/+$/, '');
    const list = (value: string | undefined, fallback: string) =>
      (value ?? fallback)
        .split(',')
        .map((type) => type.trim().toLowerCase())
        .filter((type) => EXTENSIONS[type]);
    this.settings = {
      [CreativeType.VIDEO]: {
        types: list(
          config.get<string>('CREATIVE_VIDEO_TYPES'),
          'video/mp4,video/webm',
        ).filter((type) => type.startsWith('video/')),
        maxBytes: Number(config.get('CREATIVE_VIDEO_MAX_MB', 100)) * MB,
      },
      [CreativeType.IMAGE]: {
        types: list(
          config.get<string>('CREATIVE_IMAGE_TYPES'),
          'image/jpeg,image/png,image/webp',
        ).filter((type) => type.startsWith('image/')),
        maxBytes: Number(config.get('CREATIVE_IMAGE_MAX_MB', 10)) * MB,
      },
    };
  }

  /**
   * Yuklash uchun imzolangan POST policy (TC1, TC3). Sozlamada yo‘q tur yoki chegaradan katta hajm — 400 (TC2).
   * Kalit — `creatives/<mahsulot>/<uuid>.<kengaytma>`: tasdiqlashda shu mahsulotga tegishliligi tekshiriladi.
   */
  async uploadPolicy(input: {
    productId: string;
    type: CreativeType;
    contentType: string;
    size: number;
  }): Promise<CreativeUploadPolicyDto> {
    const productId = String(input?.productId ?? '');
    if (!ID.test(productId))
      throw new BadRequestException('Mahsulot ID si noto‘g‘ri');
    const settings = this.settings[input?.type];
    if (!settings) throw new BadRequestException('Kreativ turi noto‘g‘ri');
    const contentType = String(input?.contentType ?? '')
      .trim()
      .toLowerCase();
    if (!settings.types.includes(contentType))
      throw new BadRequestException(
        `Bu fayl turi ruxsat etilmagan: ${contentType || '—'}. Ruxsat: ${settings.types.join(', ')}`,
      );
    const size = Number(input?.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > settings.maxBytes)
      throw new BadRequestException(
        `Fayl hajmi ${Math.round(settings.maxBytes / MB)} MB dan oshmasligi kerak`,
      );
    const objectKey = `${CREATIVE_FOLDER}/${productId}/${randomUUID()}${EXTENSIONS[contentType]}`;
    const expiresAt = new Date(Date.now() + POLICY_TTL_MS);
    const policy = this.client.newPostPolicy();
    policy.setBucket(this.bucket);
    policy.setKey(objectKey);
    policy.setContentType(contentType);
    policy.setContentLengthRange(1, settings.maxBytes);
    policy.setExpires(expiresAt);
    const { formData } = await this.client.presignedPostPolicy(policy);
    return {
      // ichki manzil emas — ochiq manzil (prodda API domeni `/media` orqali)
      url: `${this.publicBaseUrl}/${this.bucket}`,
      fields: formData,
      objectKey,
      expiresAt: expiresAt.toISOString(),
      maxSize: settings.maxBytes,
    };
  }

  /**
   * Yuklangan faylni tekshiradi: shu mahsulot kaliti, bor, hajmi va turi sozlamada, birinchi baytlari turiga mos
   * (masalan, «video/mp4» deb yuklangan HTML ochiq havolada tarqalmasin). Mos kelmasa fayl o‘chiriladi va 400.
   */
  async verify(input: {
    productId: string;
    objectKey: string;
  }): Promise<VerifiedCreativeFile> {
    const productId = String(input?.productId ?? '');
    const objectKey = String(input?.objectKey ?? '');
    if (!ID.test(productId) || !this.isProductKey(productId, objectKey))
      throw new BadRequestException('Fayl kaliti bu mahsulotga tegishli emas');
    let stat: { size: number; metaData: Record<string, unknown> };
    try {
      stat = await this.client.statObject(this.bucket, objectKey);
    } catch {
      throw new BadRequestException('Fayl topilmadi — avval yuklang');
    }
    const mimeType = String(
      stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'] ?? '',
    ).toLowerCase();
    const type = (Object.keys(this.settings) as CreativeType[]).find((key) =>
      this.settings[key].types.includes(mimeType),
    );
    const problem = !type
      ? `fayl turi ruxsat etilmagan: ${mimeType || '—'}`
      : stat.size < 1 || stat.size > this.settings[type].maxBytes
        ? `fayl hajmi chegaradan tashqarida: ${stat.size}`
        : !(await this.signatureMatches(objectKey, mimeType))
          ? 'fayl tarkibi ko‘rsatilgan turga mos emas'
          : null;
    if (problem) {
      await this.removeQuietly(objectKey);
      throw new BadRequestException(`Kreativ qabul qilinmadi: ${problem}`);
    }
    return {
      objectKey,
      url: `${this.publicBaseUrl}/${this.bucket}/${objectKey}`,
      type: type!,
      mimeType,
      size: stat.size,
    };
  }

  /** Kreativ o‘chirilganda fayl ham o‘chiriladi (topilmasa — jim). */
  async remove(input: { objectKey: string }): Promise<{ removed: boolean }> {
    const objectKey = String(input?.objectKey ?? '');
    if (
      !new RegExp(
        `^${CREATIVE_FOLDER}/\\d+/[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`,
      ).test(objectKey)
    )
      throw new BadRequestException('Fayl kaliti noto‘g‘ri');
    await this.removeQuietly(objectKey);
    return { removed: true };
  }

  private isProductKey(productId: string, objectKey: string): boolean {
    return new RegExp(
      `^${CREATIVE_FOLDER}/${productId}/[0-9a-f-]{36}\\.(mp4|webm|jpg|png|webp)$`,
    ).test(objectKey);
  }

  private async removeQuietly(objectKey: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, objectKey);
    } catch (error) {
      this.logger.warn(
        `Kreativ fayli o‘chirilmadi (${objectKey}): ${(error as Error).message}`,
      );
    }
  }

  /** Faylning birinchi baytlari turiga mos (mp4 — `ftyp`, webm — EBML, rasm — imzosi). */
  private async signatureMatches(
    objectKey: string,
    mimeType: string,
  ): Promise<boolean> {
    const head = await readAll(
      await this.client.getPartialObject(this.bucket, objectKey, 0, 16),
    );
    if (mimeType === 'video/mp4')
      return head.length >= 8 && head.toString('ascii', 4, 8) === 'ftyp';
    if (mimeType === 'video/webm')
      return (
        head.length >= 4 &&
        head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      );
    if (mimeType === 'image/jpeg')
      return (
        head.length >= 3 &&
        head[0] === 0xff &&
        head[1] === 0xd8 &&
        head[2] === 0xff
      );
    if (mimeType === 'image/png')
      return (
        head.length >= 8 &&
        head
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    if (mimeType === 'image/webp')
      return (
        head.length >= 12 &&
        head.toString('ascii', 0, 4) === 'RIFF' &&
        head.toString('ascii', 8, 12) === 'WEBP'
      );
    return false;
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

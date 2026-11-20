import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, CopyConditions, LifecycleRule } from 'minio';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  CREATIVE_FOLDER,
  CREATIVE_UPLOAD_FOLDER,
  CREATIVE_UPLOAD_KEY,
  CreativeType,
  CreativeUploadPolicyDto,
  creativeKeyFromUpload,
  VerifiedCreativeFile,
} from '@app/common';

/** Yuklash imzosining amal qilish muddati [taklif]: 80 MB sekin internetda ham sig‘sin. */
const POLICY_TTL_MS = 15 * 60 * 1000;
/** Tasdiqlanmagan yuklamalar shuncha kundan keyin o‘chadi (MinIO lifecycle) [taklif]. */
const UPLOAD_EXPIRY_DAYS = 1;
const UPLOAD_EXPIRY_RULE_ID = 'elchi-creative-uploads-expire';
const MB = 1024 * 1024;
const ID = /^[1-9]\d{0,18}$/;
const FINAL_KEY = new RegExp(
  `^${CREATIVE_FOLDER}/\\d{1,19}/[0-9a-f-]{36}\\.(?:mp4|webm|jpg|png|webp)$`,
);

/** Ruxsat etilgan fayl turi → kengaytma (sozlamadagi tur shu ro‘yxatda bo‘lishi kerak). */
export const CREATIVE_EXTENSIONS: Record<string, string> = {
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

interface ObjectStat {
  size: number;
  etag: string;
  metaData: Record<string, unknown>;
}

/**
 * Kreativ fayllari (BE-08): imzolangan POST policy bilan to‘g‘ridan-to‘g‘ri MinIO ga yuklash va yuklangandan keyin
 * tekshirish.
 *
 * POST policy (PUT emas): imzo faqat qoidalar hujjati ustidan — bucket, kalit, fayl turi, hajm oralig‘i. Yo‘l ustidan
 * emas, shuning uchun prodda `https://api…/media/<bucket>` orqali (Caddy `/media` prefiksini olib tashlaydi) ham
 * ishlaydi. Hajm chegarasi va fayl turini MinIO o‘zi tekshiradi.
 *
 * Fayl yopiq `creative-uploads/` ga yuklanadi; tekshiruvdan o‘tgan aynan o‘sha versiya (ETag) ochiq `creatives/` ga
 * server tomonida ko‘chiriladi.
 */
@Injectable()
export class CreativeFileService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CreativeFileService.name);
  private readonly client: Client;
  /** Policy imzolovchi: alohida kalit berilgan bo‘lsa (faqat `creative-uploads/*` ga yozish), aks holda asosiy. */
  private readonly signer: Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly settings: Record<CreativeType, TypeSettings>;

  constructor(config: ConfigService) {
    const connection = {
      endPoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: Number(config.getOrThrow<number>('MINIO_PORT')),
      useSSL: config.get<boolean>('MINIO_USE_SSL', false),
      // imzo hisobi uchun mintaqa — tarmoq orqali so‘ralmasin
      region: config.get<string>('MINIO_REGION', 'us-east-1'),
    };
    this.client = new Client({
      ...connection,
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
    const uploadAccessKey = config.get<string>('CREATIVE_UPLOAD_ACCESS_KEY');
    const uploadSecretKey = config.get<string>('CREATIVE_UPLOAD_SECRET_KEY');
    this.signer =
      uploadAccessKey && uploadSecretKey
        ? new Client({
            ...connection,
            accessKey: uploadAccessKey,
            secretKey: uploadSecretKey,
          })
        : this.client;
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    this.publicBaseUrl = config
      .getOrThrow<string>('MINIO_PUBLIC_URL')
      .replace(/\/+$/, '');
    const list = (value: string | undefined, fallback: string) =>
      (value ?? fallback)
        .split(',')
        .map((type) => type.trim().toLowerCase())
        .filter((type) => CREATIVE_EXTENSIONS[type]);
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

  /** Bucket file-service `onModuleInit` da yaratilgan — keyin yuklama papkasiga muddat qo‘yiladi. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureUploadExpiry();
    } catch (error) {
      this.logger.warn(
        `Yuklama papkasi uchun lifecycle qo‘yilmadi: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Yuklash uchun imzolangan POST policy (TC1, TC3). Sozlamada yo‘q tur yoki chegaradan katta hajm — 400 (TC2).
   * Kalit — `creative-uploads/<mahsulot>/<uuid>.<kengaytma>`: tasdiqlashda shu mahsulotga tegishliligi tekshiriladi.
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
        `Bu fayl turi ruxsat etilmagan: ${contentType || '—'}. Ruxsat: ${settings.types.join(', ') || '—'}`,
      );
    const size = Number(input?.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > settings.maxBytes)
      throw new BadRequestException(
        `Fayl hajmi ${Math.round(settings.maxBytes / MB)} MB dan oshmasligi kerak`,
      );
    const objectKey = `${CREATIVE_UPLOAD_FOLDER}/${productId}/${randomUUID()}${CREATIVE_EXTENSIONS[contentType]}`;
    const expiresAt = new Date(Date.now() + POLICY_TTL_MS);
    const policy = this.signer.newPostPolicy();
    policy.setBucket(this.bucket);
    policy.setKey(objectKey);
    policy.setContentType(contentType);
    policy.setContentLengthRange(1, settings.maxBytes);
    policy.setExpires(expiresAt);
    const { formData } = await this.signer.presignedPostPolicy(policy);
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
   * (masalan, «video/mp4» deb yuklangan HTML ochiq havolada tarqalmasin). Mos kelmasa yuklama o‘chiriladi va 400.
   * Mos kelsa aynan tekshirilgan versiya `creatives/` ga ko‘chiriladi va yakuniy kalit qaytadi.
   *
   * Qayta tasdiq (oldingi javob yetib kelmagan): yuklama allaqachon ko‘chirilgan bo‘lsa, yakuniy fayl qaytadi.
   */
  async verify(input: {
    productId: string;
    objectKey: string;
  }): Promise<VerifiedCreativeFile> {
    const productId = String(input?.productId ?? '');
    const uploadKey = String(input?.objectKey ?? '');
    const match = CREATIVE_UPLOAD_KEY.exec(uploadKey);
    const finalKey = creativeKeyFromUpload(uploadKey);
    if (!ID.test(productId) || !match || match[1] !== productId || !finalKey)
      throw new BadRequestException('Fayl kaliti bu mahsulotga tegishli emas');
    const upload = await this.statOrNull(uploadKey);
    if (!upload) return this.alreadyCopied(finalKey);
    const mimeType = this.mimeTypeOf(upload);
    const type = this.typeOf(mimeType);
    let signatureOk: boolean;
    try {
      signatureOk =
        !!type && (await this.signatureMatches(uploadKey, mimeType));
    } catch (error) {
      // parallel tasdiq yuklamani ko‘chirib o‘chirib ulgurgan
      if (this.isMissing(error)) return this.alreadyCopied(finalKey);
      throw this.unavailable('o‘qish', error);
    }
    const problem = !type
      ? `fayl turi ruxsat etilmagan: ${mimeType || '—'}`
      : upload.size < 1 || upload.size > this.settings[type].maxBytes
        ? `fayl hajmi chegaradan tashqarida: ${upload.size}`
        : !signatureOk
          ? 'fayl tarkibi ko‘rsatilgan turga mos emas'
          : null;
    if (problem) {
      await this.removeQuietly(uploadKey);
      throw new BadRequestException(`Kreativ qabul qilinmadi: ${problem}`);
    }
    // aynan tekshirilgan versiya ko‘chirilsin: tekshiruv paytida imzo bilan qayta yuklangan bo‘lsa — ko‘chmaydi
    const conditions = new CopyConditions();
    conditions.setMatchETag(upload.etag);
    try {
      await this.client.copyObject(
        this.bucket,
        finalKey,
        `/${this.bucket}/${uploadKey}`,
        conditions,
      );
    } catch (error) {
      if (this.errorCode(error) === 'PreconditionFailed')
        throw new ConflictException(
          'Fayl tekshiruv paytida o‘zgardi — qayta tasdiqlang',
        );
      if (this.isMissing(error)) return this.alreadyCopied(finalKey);
      throw this.unavailable('ko‘chirish', error);
    }
    await this.removeQuietly(uploadKey);
    return this.result(finalKey, type!, mimeType, upload.size);
  }

  /** Kreativ o‘chirilganda (yoki yozilmaganda) fayl ham o‘chiriladi (topilmasa — jim). */
  async remove(input: { objectKey: string }): Promise<{ removed: boolean }> {
    const objectKey = String(input?.objectKey ?? '');
    if (!FINAL_KEY.test(objectKey) && !CREATIVE_UPLOAD_KEY.test(objectKey))
      throw new BadRequestException('Fayl kaliti noto‘g‘ri');
    await this.client.removeObject(this.bucket, objectKey).catch((error) => {
      throw this.unavailable('o‘chirish', error);
    });
    return { removed: true };
  }

  private result(
    objectKey: string,
    type: CreativeType,
    mimeType: string,
    size: number,
  ): VerifiedCreativeFile {
    return {
      objectKey,
      url: `${this.publicBaseUrl}/${this.bucket}/${objectKey}`,
      type,
      mimeType,
      size,
    };
  }

  /** Yuklama yo‘q: oldingi (yoki parallel) tasdiqda ko‘chirilgan bo‘lsa — yakuniy fayl (u yerga faqat tekshirilgani tushadi). */
  private async alreadyCopied(finalKey: string): Promise<VerifiedCreativeFile> {
    const copied = await this.statOrNull(finalKey);
    const mimeType = copied ? this.mimeTypeOf(copied) : '';
    const type = this.typeOf(mimeType);
    if (!copied || !type)
      throw new BadRequestException('Fayl topilmadi — avval yuklang');
    return this.result(finalKey, type, mimeType, copied.size);
  }

  private isMissing(error: unknown): boolean {
    const code = this.errorCode(error);
    return code === 'NotFound' || code === 'NoSuchKey';
  }

  private mimeTypeOf(stat: ObjectStat): string {
    return String(
      stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'] ?? '',
    ).toLowerCase();
  }

  private typeOf(mimeType: string): CreativeType | undefined {
    return (Object.keys(this.settings) as CreativeType[]).find((key) =>
      this.settings[key].types.includes(mimeType),
    );
  }

  /** Fayl yo‘q — null; MinIO ishlamasa yoki ruxsat yo‘q — 503 (400 «topilmadi» emas). */
  private async statOrNull(objectKey: string): Promise<ObjectStat | null> {
    try {
      return (await this.client.statObject(
        this.bucket,
        objectKey,
      )) as ObjectStat;
    } catch (error) {
      if (this.isMissing(error)) return null;
      throw this.unavailable('tekshirish', error);
    }
  }

  private errorCode(error: unknown): string | undefined {
    return (error as { code?: string })?.code;
  }

  private unavailable(
    action: string,
    error: unknown,
  ): ServiceUnavailableException {
    this.logger.error(
      `Kreativ faylini ${action}da MinIO xatosi: ${(error as Error)?.message}`,
    );
    return new ServiceUnavailableException(
      'Fayl ombori vaqtincha ishlamayapti — birozdan so‘ng qayta urinib ko‘ring',
    );
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

  /** `creative-uploads/` dagi tasdiqlanmagan fayllar 1 kunda o‘chadi; bucketdagi boshqa qoidalar saqlanadi. */
  private async ensureUploadExpiry(): Promise<void> {
    const current = await this.client
      .getBucketLifecycle(this.bucket)
      .catch((error) => {
        if (this.errorCode(error) === 'NoSuchLifecycleConfiguration')
          return null;
        throw error;
      });
    // minio klienti bitta qoidani massiv emas, obyekt qilib qaytaradi
    const rules = ([] as LifecycleRule[]).concat(current?.Rule ?? []);
    const others = rules.filter((rule) => rule.ID !== UPLOAD_EXPIRY_RULE_ID);
    const mine = rules.find((rule) => rule.ID === UPLOAD_EXPIRY_RULE_ID);
    if (
      mine?.Status === 'Enabled' &&
      mine.Filter?.Prefix === `${CREATIVE_UPLOAD_FOLDER}/` &&
      Number(mine.Expiration?.Days) === UPLOAD_EXPIRY_DAYS
    )
      return;
    await this.client.setBucketLifecycle(this.bucket, {
      Rule: [
        ...others,
        {
          ID: UPLOAD_EXPIRY_RULE_ID,
          Status: 'Enabled',
          Filter: { Prefix: `${CREATIVE_UPLOAD_FOLDER}/` },
          Expiration: { Days: UPLOAD_EXPIRY_DAYS },
        },
      ],
    });
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

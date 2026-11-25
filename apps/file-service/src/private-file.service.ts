import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, CopyConditions } from 'minio';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AffiliateDocumentFile,
  ErrorCode,
  PRIVATE_DOCUMENT_MAX_BYTES,
  PRIVATE_DOCUMENT_TYPES,
  PrivateDocumentContentType,
  PrivateFileVerified,
  PrivateUploadPolicyResultDto,
  RETURN_PHOTO_MAX_BYTES,
  SelfEmployedDocumentDto,
  StoredReturnPhoto,
} from '@app/common';

/** Yopiq yuklamalar papkasi — tasdiqlanmagani 1 kunda o‘chadi (lifecycle — CreativeFileService). */
export const PRIVATE_UPLOAD_FOLDER = 'private-uploads';
/** Yopiq hujjatlar — bucket siyosatida ochiq emas (ochiq faqat products, banners, creatives). */
export const PRIVATE_FOLDER = 'private/wholesaler';
const POLICY_TTL_MS = 15 * 60 * 1000;
const ID = /^[1-9]\d{0,18}$/;
const EXTENSIONS: Record<PrivateDocumentContentType, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};
const UPLOAD_KEY = new RegExp(
  `^${PRIVATE_UPLOAD_FOLDER}/(\\d{1,19})/([0-9a-f-]{36})\\.(pdf|jpg|png)$`,
);
/** BE-25 5-tur: sotuvchining maqom ma’lumotnomasi (yuborilgan) — optovik hujjatlari bilan bir xil yopiq. */
export const AFFILIATE_FOLDER = 'private/affiliate';
/** Hali yuborilmagan ma’lumotnoma — 1 kunda o‘chadi (`private-uploads` lifecycle). */
export const AFFILIATE_UPLOAD_FOLDER = `${PRIVATE_UPLOAD_FOLDER}/affiliate`;
/** BE-25 (FE-26): qaytarish so‘roviga mijoz rasmlari — yopiq. */
export const RETURN_PHOTO_FOLDER = 'private/returns';
const RETURN_PHOTO_KEY = new RegExp(
  `^${RETURN_PHOTO_FOLDER}/\\d{1,19}/[0-9a-f-]{36}\\.(?:jpg|png|webp)$`,
);
const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const DOCUMENT_KEY = new RegExp(
  `^(?:${PRIVATE_FOLDER}|${AFFILIATE_FOLDER})/\\d{1,19}/[0-9a-f-]{36}\\.(?:pdf|jpg|png)$`,
);
const DOCUMENT_ID = /^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/;
/** Fayl nomi MinIO metama’lumotida — header faqat ASCII, shuning uchun base64url. */
const NAME_META = 'elchi-name';

interface ObjectStat {
  size: number;
  etag: string;
  metaData: Record<string, unknown>;
}

/**
 * BE-30 (OPT-1 KYC, OPT-2 sertifikat): optovikning yopiq hujjatlari. Yuklash — BE-08 dagi kabi imzolangan POST
 * policy (`private-uploads/<optovik>/…`), tekshiruv (tur, hajm, bosh baytlar, ETag) va `private/wholesaler/<optovik>/`
 * ga server nusxasi. O‘qish faqat shu servis orqali (gateway imzolangan havola bilan beradi) — ochiq URL yo‘q.
 */
@Injectable()
export class PrivateFileService {
  private readonly logger = new Logger(PrivateFileService.name);
  private readonly client: Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    this.client = new Client({
      endPoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: Number(config.getOrThrow<number>('MINIO_PORT')),
      useSSL: config.get<boolean>('MINIO_USE_SSL', false),
      region: config.get<string>('MINIO_REGION', 'us-east-1'),
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    this.publicBaseUrl = config
      .getOrThrow<string>('MINIO_PUBLIC_URL')
      .replace(/\/+$/, '');
  }

  async uploadPolicy(input: {
    wholesalerId: string;
    contentType: string;
    size: number;
  }): Promise<PrivateUploadPolicyResultDto> {
    const wholesalerId = String(input?.wholesalerId ?? '');
    if (!ID.test(wholesalerId))
      throw new BadRequestException('Optovik ID si noto‘g‘ri');
    const contentType = String(input?.contentType ?? '')
      .trim()
      .toLowerCase() as PrivateDocumentContentType;
    if (!PRIVATE_DOCUMENT_TYPES.includes(contentType))
      throw new BadRequestException(
        `Bu fayl turi ruxsat etilmagan: ${contentType || '—'}. Ruxsat: ${PRIVATE_DOCUMENT_TYPES.join(', ')}`,
      );
    const size = Number(input?.size);
    if (
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > PRIVATE_DOCUMENT_MAX_BYTES
    )
      throw new BadRequestException('Fayl hajmi 10 MB dan oshmasligi kerak');
    const objectKey = `${PRIVATE_UPLOAD_FOLDER}/${wholesalerId}/${randomUUID()}${EXTENSIONS[contentType]}`;
    const expiresAt = new Date(Date.now() + POLICY_TTL_MS);
    const policy = this.client.newPostPolicy();
    policy.setBucket(this.bucket);
    policy.setKey(objectKey);
    policy.setContentType(contentType);
    policy.setContentLengthRange(1, PRIVATE_DOCUMENT_MAX_BYTES);
    policy.setExpires(expiresAt);
    const { formData } = await this.client
      .presignedPostPolicy(policy)
      .catch((error) => {
        throw this.unavailable('imzolash', error);
      });
    return {
      url: `${this.publicBaseUrl}/${this.bucket}`,
      fields: formData,
      objectKey,
      expiresAt: expiresAt.toISOString(),
      maxSize: PRIVATE_DOCUMENT_MAX_BYTES,
    };
  }

  /** Yuklamani tekshirib yopiq joyga ko‘chiradi; mos kelmasa — o‘chiriladi va 400. Takror — yakuniy fayl. */
  async verify(input: {
    wholesalerId: string;
    objectKey: string;
  }): Promise<PrivateFileVerified> {
    const wholesalerId = String(input?.wholesalerId ?? '');
    const uploadKey = String(input?.objectKey ?? '');
    const match = UPLOAD_KEY.exec(uploadKey);
    if (!ID.test(wholesalerId) || !match || match[1] !== wholesalerId)
      throw new BadRequestException('Fayl kaliti bu optovikka tegishli emas');
    const finalKey = `${PRIVATE_FOLDER}/${wholesalerId}/${match[2]}.${match[3]}`;
    const upload = await this.statOrNull(uploadKey);
    if (!upload) return this.alreadyCopied(finalKey);
    // yakuniy fayl allaqachon bor (tasdiqlangan, admin ko‘rgan bo‘lishi mumkin) — almashtirilmaydi: imzo 15 daqiqa
    // amal qiladi, shu kalitga qayta yuklangan yangi fayl o‘chiriladi, natija — avvalgi fayl
    if (await this.statOrNull(finalKey)) {
      await this.removeQuietly(uploadKey);
      return this.alreadyCopied(finalKey);
    }
    const contentType = mimeTypeOf(upload);
    const allowed = PRIVATE_DOCUMENT_TYPES.includes(contentType);
    const head = allowed ? await this.head(uploadKey, upload.etag) : null;
    const problem = !allowed
      ? `fayl turi ruxsat etilmagan: ${contentType || '—'}`
      : upload.size < 1 || upload.size > PRIVATE_DOCUMENT_MAX_BYTES
        ? `fayl hajmi chegaradan tashqarida: ${upload.size}`
        : EXTENSIONS[contentType] !== `.${match[3]}` ||
            !signatureMatches(head!, contentType)
          ? 'fayl tarkibi ko‘rsatilgan turga mos emas'
          : null;
    if (problem) {
      await this.removeQuietly(uploadKey);
      throw new BadRequestException(`Hujjat qabul qilinmadi: ${problem}`);
    }
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
      if (errorCode(error) === 'PreconditionFailed')
        throw new ConflictException(
          'Fayl tekshiruv paytida o‘zgardi — qayta tasdiqlang',
        );
      if (isMissing(error)) return this.alreadyCopied(finalKey);
      throw this.unavailable('ko‘chirish', error);
    }
    await this.removeQuietly(uploadKey);
    return { objectKey: finalKey, contentType, size: upload.size };
  }

  /** Yopiq hujjat (faqat `private/wholesaler/…`, `private/affiliate/…` va `private/returns/…`) — base64; gateway imzoni yoki egasini tekshirgandan keyin chaqiradi. */
  async get(input: {
    objectKey: string;
  }): Promise<{ contentType: string; size: number; base64: string }> {
    const objectKey = String(input?.objectKey ?? '');
    if (!DOCUMENT_KEY.test(objectKey) && !RETURN_PHOTO_KEY.test(objectKey))
      throw new BadRequestException('Fayl kaliti noto‘g‘ri');
    const stat = await this.statOrNull(objectKey);
    if (!stat) throw new NotFoundException('Fayl topilmadi');
    if (stat.size > PRIVATE_DOCUMENT_MAX_BYTES)
      throw new ConflictException('Fayl hajmi chegaradan katta');
    const stream = await this.client
      .getObject(this.bucket, objectKey)
      .catch((error) => {
        throw this.unavailable('o‘qish', error);
      });
    const body = await readAll(stream);
    return {
      contentType: mimeTypeOf(stat),
      size: body.length,
      base64: body.toString('base64'),
    };
  }

  // ------------------------------------------------------------------ sotuvchi ma’lumotnomasi (BE-25 5-tur)

  /** Tanlangan fayl vaqtinchalik yopiq joyga; tur bosh baytlardan tekshiriladi. `documentId` faqat egasiga ishlaydi. */
  async storeAffiliateDocument(input: {
    affiliateId: string;
    fileName: string;
    base64: string;
  }): Promise<SelfEmployedDocumentDto> {
    const affiliateId = this.affiliateId(input?.affiliateId);
    const body = Buffer.from(String(input?.base64 ?? ''), 'base64');
    if (!body.length)
      throw new BadRequestException({
        message: 'Faylni tanlang',
        errorCode: ErrorCode.FILE_REQUIRED,
      });
    if (body.length > PRIVATE_DOCUMENT_MAX_BYTES)
      throw new PayloadTooLargeException({
        message: 'Fayl 10 MB dan katta',
        errorCode: ErrorCode.FILE_TOO_LARGE,
      });
    // tur brauzer aytganidan emas, bosh baytlardan (ba’zi qurilmalar turini bo‘sh yuboradi)
    const contentType = PRIVATE_DOCUMENT_TYPES.find((type) =>
      signatureMatches(body.subarray(0, 16), type),
    );
    if (!contentType)
      throw new BadRequestException({
        message: 'Faqat PDF, JPG yoki PNG',
        errorCode: ErrorCode.FILE_TYPE_INVALID,
      });
    const name = documentName(input?.fileName, EXTENSIONS[contentType]);
    const documentId = `${randomUUID()}${EXTENSIONS[contentType]}`;
    await this.client
      .putObject(
        this.bucket,
        `${AFFILIATE_UPLOAD_FOLDER}/${affiliateId}/${documentId}`,
        body,
        body.length,
        {
          'Content-Type': contentType,
          [`X-Amz-Meta-${NAME_META}`]: Buffer.from(name, 'utf8').toString(
            'base64url',
          ),
        },
      )
      .catch((error) => {
        throw this.unavailable('saqlash', error);
      });
    return { documentId, name };
  }

  /**
   * Yuborilgan arizaning ma’lumotnomasi doimiy yopiq joyga ko‘chiriladi. Har chaqiriq — yangi kalit: muvaffaqiyatsiz
   * yuborishning nusxasi o‘chirilsa, boshqa arizaning fayliga tegilmaydi. Vaqtinchalik nusxa lifecycle bilan o‘chadi.
   */
  async commitAffiliateDocument(input: {
    affiliateId: string;
    documentId: string;
    /** Chaqiruvchi shu vaqtgacha kutadi (epoch ms) — kechikkan buyruq egasiz nusxa qoldirmasin. */
    deadline: number;
  }): Promise<AffiliateDocumentFile> {
    const affiliateId = this.affiliateId(input?.affiliateId);
    const documentId = String(input?.documentId ?? '');
    const missing = () =>
      new BadRequestException({
        message: 'Hujjat topilmadi — qayta yuklang',
        errorCode: ErrorCode.DOCUMENT_NOT_FOUND,
      });
    if (!DOCUMENT_ID.test(documentId) || !(Date.now() < input.deadline))
      throw missing();
    const uploadKey = `${AFFILIATE_UPLOAD_FOLDER}/${affiliateId}/${documentId}`;
    const upload = await this.statOrNull(uploadKey);
    if (!upload) throw missing();
    const objectKey = `${AFFILIATE_FOLDER}/${affiliateId}/${randomUUID()}${documentId.slice(36)}`;
    const conditions = new CopyConditions();
    conditions.setMatchETag(upload.etag);
    try {
      await this.client.copyObject(
        this.bucket,
        objectKey,
        `/${this.bucket}/${uploadKey}`,
        conditions,
      );
    } catch (error) {
      if (isMissing(error) || errorCode(error) === 'PreconditionFailed')
        throw missing();
      throw this.unavailable('ko‘chirish', error);
    }
    return {
      objectKey,
      fileName:
        Buffer.from(
          String(upload.metaData?.[NAME_META] ?? ''),
          'base64url',
        ).toString('utf8') || `hujjat${documentId.slice(36)}`,
      contentType: mimeTypeOf(upload),
      size: upload.size,
    };
  }

  /** Ariza yaratilmadi — ko‘chirilgan nusxa qolmasin. Faqat sotuvchi papkasi. */
  async removeAffiliateDocument(input: {
    affiliateId: string;
    objectKey: string;
  }): Promise<{ removed: boolean }> {
    const affiliateId = this.affiliateId(input?.affiliateId);
    const objectKey = String(input?.objectKey ?? '');
    if (
      !DOCUMENT_KEY.test(objectKey) ||
      !objectKey.startsWith(`${AFFILIATE_FOLDER}/${affiliateId}/`)
    )
      throw new BadRequestException('Fayl kaliti noto‘g‘ri');
    await this.removeQuietly(objectKey);
    return { removed: true };
  }

  // ------------------------------------------------------------------ qaytarish rasmlari (BE-25 8-tur)

  /** Rasm turi bosh baytlardan (JPEG, PNG, WEBP); nomi saqlanmaydi. */
  async storeReturnPhoto(input: {
    returnId: string;
    base64: string;
  }): Promise<StoredReturnPhoto> {
    const returnId = String(input?.returnId ?? '');
    if (!ID.test(returnId))
      throw new BadRequestException('Qaytarish so‘rovi ID si noto‘g‘ri');
    const body = Buffer.from(String(input?.base64 ?? ''), 'base64');
    if (!body.length)
      throw new BadRequestException({
        message: 'Rasm tanlanmagan',
        errorCode: ErrorCode.FILE_REQUIRED,
      });
    if (body.length > RETURN_PHOTO_MAX_BYTES)
      throw new PayloadTooLargeException({
        message: 'Rasm 5 MB dan katta',
        errorCode: ErrorCode.FILE_TOO_LARGE,
      });
    const contentType = photoType(body.subarray(0, 16));
    if (!contentType)
      throw new BadRequestException({
        message: 'Faqat JPG, PNG yoki WEBP rasm',
        errorCode: ErrorCode.FILE_TYPE_INVALID,
      });
    const objectKey = `${RETURN_PHOTO_FOLDER}/${returnId}/${randomUUID()}${PHOTO_EXTENSIONS[contentType]}`;
    await this.client
      .putObject(this.bucket, objectKey, body, body.length, {
        'Content-Type': contentType,
      })
      .catch((error) => {
        throw this.unavailable('saqlash', error);
      });
    return { objectKey, contentType, size: body.length };
  }

  /** So‘rovga yozilmay qolgan rasm qolmasin. */
  async removeReturnPhoto(input: {
    objectKey: string;
  }): Promise<{ removed: boolean }> {
    const objectKey = String(input?.objectKey ?? '');
    if (!RETURN_PHOTO_KEY.test(objectKey))
      throw new BadRequestException('Fayl kaliti noto‘g‘ri');
    await this.removeQuietly(objectKey);
    return { removed: true };
  }

  private affiliateId(value: unknown): string {
    const id = String(value ?? '');
    if (!ID.test(id)) throw new BadRequestException('Sotuvchi ID si noto‘g‘ri');
    return id;
  }

  private async alreadyCopied(finalKey: string): Promise<PrivateFileVerified> {
    const copied = await this.statOrNull(finalKey);
    const contentType = copied ? mimeTypeOf(copied) : null;
    if (
      !copied ||
      !contentType ||
      !PRIVATE_DOCUMENT_TYPES.includes(contentType)
    )
      throw new BadRequestException('Fayl topilmadi — avval yuklang');
    return { objectKey: finalKey, contentType, size: copied.size };
  }

  /** Birinchi baytlar — stat dagi versiyadan (ETag bir xil), aks holda 409. */
  private async head(objectKey: string, etag: string): Promise<Buffer> {
    const stream = await this.client
      .getPartialObject(this.bucket, objectKey, 0, 16)
      .catch((error) => {
        throw this.unavailable('o‘qish', error);
      });
    const head = await readAll(stream);
    const readEtag = (
      stream as Readable & { headers?: Record<string, unknown> }
    ).headers?.etag;
    if (unquote(readEtag) !== unquote(etag))
      throw new ConflictException(
        'Fayl tekshiruv paytida o‘zgardi — qayta tasdiqlang',
      );
    return head;
  }

  private async statOrNull(objectKey: string): Promise<ObjectStat | null> {
    try {
      return (await this.client.statObject(
        this.bucket,
        objectKey,
      )) as ObjectStat;
    } catch (error) {
      if (isMissing(error)) return null;
      throw this.unavailable('tekshirish', error);
    }
  }

  private unavailable(action: string, error: unknown) {
    this.logger.error(
      `Yopiq hujjatni ${action}da MinIO xatosi: ${(error as Error)?.message}`,
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
        `Yuklama o‘chirilmadi (${objectKey}): ${(error as Error).message}`,
      );
    }
  }
}

/** JPEG, PNG yoki WEBP — bosh baytlardan; boshqa — null. */
export function photoType(head: Buffer): string | null {
  if (signatureMatches(head, 'image/jpeg')) return 'image/jpeg';
  if (signatureMatches(head, 'image/png')) return 'image/png';
  return head.length >= 12 &&
    head.toString('ascii', 0, 4) === 'RIFF' &&
    head.toString('ascii', 8, 12) === 'WEBP'
    ? 'image/webp'
    : null;
}

/** PDF — `%PDF-`, JPEG — FF D8 FF, PNG — imzosi. */
export function signatureMatches(
  head: Buffer,
  contentType: PrivateDocumentContentType,
): boolean {
  if (contentType === 'application/pdf')
    return head.length >= 5 && head.toString('ascii', 0, 5) === '%PDF-';
  if (contentType === 'image/jpeg')
    return (
      head.length >= 3 &&
      head[0] === 0xff &&
      head[1] === 0xd8 &&
      head[2] === 0xff
    );
  return (
    head.length >= 8 &&
    head
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

function mimeTypeOf(stat: ObjectStat): PrivateDocumentContentType {
  return String(
    stat.metaData?.['content-type'] ?? stat.metaData?.['Content-Type'] ?? '',
  ).toLowerCase() as PrivateDocumentContentType;
}

/** Yo‘l va boshqaruv belgilarisiz, tekshirilgan turning kengaytmasi bilan («x.html» → «x.pdf»). */
export function documentName(value: unknown, extension: string): string {
  const base = String(value ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .replace(/\.[^.]*$/, '')
    .trim()
    .slice(0, 150);
  return `${base || 'hujjat'}${extension}`;
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'NotFound' || code === 'NoSuchKey';
}

function unquote(etag: unknown): string {
  return String(etag ?? '').replace(/"/g, '');
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { CreativeFileRef, CreativeType } from '@app/common';
import { ZipEntry } from './store-zip';

/**
 * BE-25 (FE-05): kreativ fayllarini MinIO dan o‘qiydi (faqat o‘qish, ochiq `creatives/<mahsulot>/` papkasi). Katta
 * fayllar RMQ orqali (base64) emas — gateway to‘g‘ridan-to‘g‘ri oqim qiladi. Ulanish file-service dagi bilan bir xil
 * `MINIO_*` sozlamalaridan.
 */
@Injectable()
export class CreativeArchiveService {
  private readonly logger = new Logger(CreativeArchiveService.name);
  private client: Client | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Har fayl avval tekshiriladi (bor va hajmi) — javob sarlavhasi yuborilgunga qadar; biri o‘qilmasa — 503.
   * Fayl nomlari: `01-video.mp4`, `02-rasm.jpg` [taklif].
   */
  async entries(files: CreativeFileRef[]): Promise<ZipEntry[]> {
    const client = this.minio();
    const bucket = this.config.get<string>('MINIO_BUCKET', 'marketplace-media');
    return Promise.all(
      files.map(async (file, index) => {
        let size: number;
        try {
          size = (await client.statObject(bucket, file.objectKey)).size;
        } catch (error) {
          this.logger.error(
            `Kreativ fayli o‘qilmadi (${file.objectKey}): ${(error as Error)?.message}`,
          );
          throw new ServiceUnavailableException(
            'Kreativ fayllari o‘qilmadi — birozdan so‘ng qayta urinib ko‘ring',
          );
        }
        const ext = /\.([a-z0-9]{1,8})$/i.exec(file.objectKey)?.[1] ?? 'bin';
        const kind = file.type === CreativeType.VIDEO ? 'video' : 'rasm';
        return {
          name: `${String(index + 1).padStart(2, '0')}-${kind}.${ext.toLowerCase()}`,
          size,
          open: () => client.getObject(bucket, file.objectKey),
        };
      }),
    );
  }

  private minio(): Client {
    if (!this.client)
      this.client = new Client({
        endPoint: this.config.getOrThrow<string>('MINIO_ENDPOINT'),
        port: Number(this.config.getOrThrow<number>('MINIO_PORT')),
        useSSL: this.config.get<boolean>('MINIO_USE_SSL', false),
        region: this.config.get<string>('MINIO_REGION', 'us-east-1'),
        accessKey: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
      });
    return this.client;
  }
}

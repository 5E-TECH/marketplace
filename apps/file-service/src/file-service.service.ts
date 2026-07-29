import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { randomUUID } from 'node:crypto';
import { UploadFileCommand, UploadedFileDto } from '@app/common';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Injectable()
export class FileServiceService implements OnModuleInit {
  private readonly minioClient: Client;
  private readonly bucketName: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.minioClient = new Client({
      endPoint: this.configService.getOrThrow<string>('MINIO_ENDPOINT'),
      port: this.configService.getOrThrow<number>('MINIO_PORT'),
      useSSL: this.configService.get<boolean>('MINIO_USE_SSL', false),
      accessKey: this.configService.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: this.configService.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
    this.bucketName = this.configService.getOrThrow<string>('MINIO_BUCKET');
    this.publicBaseUrl = this.configService
      .getOrThrow<string>('MINIO_PUBLIC_URL')
      .replace(/\/+$/, '');
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  async uploadFile(command: UploadFileCommand): Promise<UploadedFileDto> {
    await this.ensureBucketExists();

    if (!command?.base64) {
      throw new BadRequestException('Fayl yuborilmadi');
    }
    const extension = EXTENSIONS[command.mimeType];
    if (!extension) {
      throw new BadRequestException(
        'Faqat JPEG, PNG va WEBP formatlari ruxsat etilgan',
      );
    }

    const buffer = Buffer.from(command.base64, 'base64');
    if (buffer.length === 0) {
      throw new BadRequestException('Fayl bo‘sh bo‘lishi mumkin emas');
    }
    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new BadRequestException('Fayl hajmi 5 MB dan oshmasligi kerak');
    }
    if (command.size !== buffer.length) {
      throw new BadRequestException('Fayl hajmi noto‘g‘ri');
    }
    if (!this.matchesSignature(buffer, command.mimeType)) {
      throw new BadRequestException(
        'Fayl tarkibi ko‘rsatilgan formatga mos emas',
      );
    }

    const objectName = `products/${Date.now()}-${randomUUID()}${extension}`;
    await this.minioClient.putObject(
      this.bucketName,
      objectName,
      buffer,
      buffer.length,
      { 'Content-Type': command.mimeType },
    );

    return {
      objectName,
      bucket: this.bucketName,
      url: `${this.publicBaseUrl}/${this.bucketName}/${objectName}`,
      mimeType: command.mimeType,
      size: buffer.length,
    };
  }

  private async ensureBucketExists(): Promise<void> {
    const bucketExists = await this.minioClient.bucketExists(this.bucketName);
    if (!bucketExists) {
      await this.minioClient.makeBucket(this.bucketName);
    }
    await this.configurePublicReadPolicy();
  }

  private async configurePublicReadPolicy(): Promise<void> {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucketName}/products/*`],
        },
      ],
    };
    await this.minioClient.setBucketPolicy(
      this.bucketName,
      JSON.stringify(policy),
    );
  }

  private matchesSignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'image/jpeg') {
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );
    }
    if (mimeType === 'image/png') {
      return (
        buffer.length >= 8 &&
        buffer
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    }
    if (mimeType === 'image/webp') {
      return (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
      );
    }
    return false;
  }
}

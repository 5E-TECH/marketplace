import { BadRequestException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {
  ErrorCode,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_TYPES,
  ProductMediaDto,
  sendRpc,
  UploadedFileDto,
} from '@app/common';

/** Multipart tana sxemasi (Swagger). */
export const PRODUCT_MEDIA_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

/** Bitta rasm, 10 MB gacha (busboy chegaraga teng faylni ham kesadi — shuning uchun +1). */
export const PRODUCT_MEDIA_OPTIONS: MulterOptions = {
  limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES + 1, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (PRODUCT_IMAGE_TYPES.includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(
      new BadRequestException({
        message: file.mimetype.startsWith('video/')
          ? 'Video mahsulot saqlangach «Kreativlar» bo‘limidan yuklanadi'
          : 'Faqat JPEG, PNG va WEBP rasm',
        errorCode: ErrorCode.FILE_TYPE_INVALID,
      }),
      false,
    );
  },
};

/** Rasm `products/` ochiq papkasiga; tur bosh baytlardan tekshiriladi (file-service). */
export async function storeProductMedia(
  files: ClientProxy,
  file: Express.Multer.File | undefined,
): Promise<ProductMediaDto> {
  if (!file?.size)
    throw new BadRequestException({
      message: 'Faylni tanlang',
      errorCode: ErrorCode.FILE_REQUIRED,
    });
  // multer nomni latin1 deb o‘qiydi — kirill va ʻ buzilmasin
  const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const stored = await sendRpc<UploadedFileDto>(
    files,
    { cmd: 'file.upload' },
    {
      originalName: fileName,
      mimeType: file.mimetype,
      size: file.size,
      base64: file.buffer.toString('base64'),
      folder: 'products',
    },
  );
  return {
    url: stored.url,
    type: 'IMAGE',
    fileName,
    contentType: stored.mimeType,
    size: stored.size,
  };
}

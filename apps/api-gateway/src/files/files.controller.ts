/// <reference types="multer" />

import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CurrentUser,
  JwtUser,
  ProductImageUploadResultDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UploadedFileDto,
  UploadProductImageDto,
} from '@app/common';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@ApiTags('files')
@ApiBearerAuth()
@Roles(Role.SELLER)
@Controller('files')
export class FilesController {
  constructor(
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Post('upload')
  @ApiOperation({
    summary: 'Mahsulot rasmini MinIO’ga yuklash va productga biriktirish',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'productId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        productId: { type: 'string', example: '12' },
        isCover: { type: 'boolean', default: false },
      },
    },
  })
  @ApiCreatedResponse({ type: ProductImageUploadResultDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  @ApiPayloadTooLargeResponse({ type: AuthErrorResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_SIZE },
      fileFilter: (_request, file, callback) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
          callback(
            new BadRequestException(
              'Faqat JPEG, PNG va WEBP formatlari ruxsat etilgan',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async upload(
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadProductImageDto,
  ): Promise<ProductImageUploadResultDto> {
    if (!file) {
      throw new BadRequestException('Fayl yuborilmadi');
    }

    await sendRpc(
      this.catalog,
      { cmd: 'product.get-one' },
      {
        ownerUserId: user.sub,
        id: dto.productId,
      },
    );

    const uploaded = await sendRpc<UploadedFileDto>(
      this.files,
      { cmd: 'file.upload' },
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        base64: file.buffer.toString('base64'),
      },
    );

    await sendRpc(
      this.catalog,
      { cmd: 'product.add-image' },
      {
        ownerUserId: user.sub,
        id: dto.productId,
        url: uploaded.url,
        isCover: dto.isCover,
      },
    );

    return {
      ...uploaded,
      productId: dto.productId,
      isCover: dto.isCover,
    };
  }
}

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateReviewDto,
  CurrentUser,
  JwtUser,
  Public,
  ReviewsQueryDto,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('reviews')
@Controller('storefront/products/:productId/reviews')
export class ReviewsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Mahsulot sharhlari va o‘rtacha reytingi' })
  list(@Param('productId') productId: string, @Query() query: ReviewsQueryDto) {
    return sendRpc(this.catalog, { cmd: 'review.list' }, { productId, query });
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Yetkazilgan mahsulotga sharh qoldirish' })
  @ApiCreatedResponse({ description: 'Sharh yaratildi' })
  create(
    @CurrentUser() user: JwtUser,
    @Param('productId') productId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'review.create' },
      { userId: user.sub, productId, dto },
    );
  }
}

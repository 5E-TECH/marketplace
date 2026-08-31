import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateReviewDto,
  ReviewsQueryDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { ReviewService } from './review.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @MessagePattern({ cmd: 'review.create' })
  create(
    @Payload()
    data: {
      userId: string;
      productId: string;
      dto: CreateReviewDto;
    },
  ) {
    return this.reviews.create(data.userId, data.productId, data.dto);
  }

  @MessagePattern({ cmd: 'review.list' })
  list(@Payload() data: { productId: string; query: ReviewsQueryDto }) {
    return this.reviews.list(data.productId, data.query);
  }
}

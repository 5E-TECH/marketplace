import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  FavoriteOwnerDto,
  FavoritesQueryDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { FavoriteService } from './favorite.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FavoriteController {
  constructor(private readonly favorites: FavoriteService) {}
  @MessagePattern({ cmd: 'favorite.add' }) add(
    @Payload() d: { owner: FavoriteOwnerDto; productId: string },
  ) {
    return this.favorites.add(d.owner, d.productId);
  }
  @MessagePattern({ cmd: 'favorite.remove' }) remove(
    @Payload() d: { owner: FavoriteOwnerDto; productId: string },
  ) {
    return this.favorites.remove(d.owner, d.productId);
  }
  @MessagePattern({ cmd: 'favorite.check' }) check(
    @Payload() d: { owner: FavoriteOwnerDto; productId: string },
  ) {
    return this.favorites.check(d.owner, d.productId);
  }
  @MessagePattern({ cmd: 'favorite.list' }) list(
    @Payload() d: { owner: FavoriteOwnerDto; query: FavoritesQueryDto },
  ) {
    return this.favorites.list(d.owner, d.query);
  }
  @MessagePattern({ cmd: 'favorite.merge' }) merge(
    @Payload() d: { userId: string; sessionId: string },
  ) {
    return this.favorites.merge(d.userId, d.sessionId);
  }
}

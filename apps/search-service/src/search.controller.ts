import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CatalogProductChangedEvent,
  RpcHttpExceptionFilter,
  SearchProductsQueryDto,
} from '@app/common';
import { SearchIndexService } from './search-index.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SearchController {
  constructor(private readonly searchIndex: SearchIndexService) {}

  @MessagePattern({ cmd: 'search.products' })
  search(@Payload() query: SearchProductsQueryDto) {
    return this.searchIndex.search(query);
  }

  @EventPattern('catalog.product.changed')
  reindex(@Payload() event: CatalogProductChangedEvent) {
    return this.searchIndex.reindex(event);
  }
}

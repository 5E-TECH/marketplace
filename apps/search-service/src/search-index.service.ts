import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  CatalogProductChangedEvent,
  SearchProductsPageDto,
  SearchProductsQueryDto,
} from '@app/common';
import { SearchDocument } from './entities/search-document.entity';

@Injectable()
export class SearchIndexService {
  constructor(
    @InjectRepository(SearchDocument)
    private readonly documents: Repository<SearchDocument>,
    private readonly dataSource: DataSource,
  ) {}

  async reindex(event: CatalogProductChangedEvent): Promise<void> {
    if (!event.active) {
      await this.documents.delete({ productId: event.productId });
      return;
    }
    const document = this.documents.create({
      productId: event.productId,
      shopId: event.shopId,
      categoryId: event.categoryId,
      title: event.title,
      content: event.content,
      slug: event.slug,
      imageUrl: event.imageUrl,
      shopName: event.shopName,
      price: event.price,
      attributes: event.attributes,
    });
    await this.documents.upsert(
      document as unknown as Parameters<typeof this.documents.upsert>[0],
      ['productId'],
    );
  }

  async search(query: SearchProductsQueryDto): Promise<SearchProductsPageDto> {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException(
        'minPrice maxPrice dan katta bo‘la olmaydi',
      );
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [query.q.trim()];
    const conditions = [
      `to_tsvector('simple', d.title || ' ' || COALESCE(d.content, '')) @@ websearch_to_tsquery('simple', $1)`,
    ];
    if (query.categoryId) {
      params.push(query.categoryId);
      conditions.push(`d.category_id = $${params.length}`);
    }
    if (query.minPrice !== undefined) {
      params.push(query.minPrice);
      conditions.push(`d.price >= $${params.length}`);
    }
    if (query.maxPrice !== undefined) {
      params.push(query.maxPrice);
      conditions.push(`d.price <= $${params.length}`);
    }
    const where = conditions.join(' AND ');
    const [countRows, facetRows, priceRows] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total FROM search.search_document d WHERE ${where}`,
        params,
      ),
      this.dataSource.query(
        `SELECT d.category_id AS "categoryId", COUNT(*)::int AS count
         FROM search.search_document d WHERE ${where} AND d.category_id IS NOT NULL
         GROUP BY d.category_id ORDER BY count DESC, d.category_id`,
        params,
      ),
      this.dataSource.query(
        `SELECT MIN(d.price) AS "minPrice", MAX(d.price) AS "maxPrice"
         FROM search.search_document d WHERE ${where}`,
        params,
      ),
    ]);
    const listParams = [...params, limit, (page - 1) * limit];
    const items = await this.dataSource.query(
      `SELECT d.product_id AS "productId", d.shop_id AS "shopId",
              d.category_id AS "categoryId", d.slug, d.title,
              d.shop_name AS "shopName", d.price, d.image_url AS "imageUrl",
              d.attributes,
              ts_rank(to_tsvector('simple', d.title || ' ' || COALESCE(d.content, '')),
                      websearch_to_tsquery('simple', $1)) AS relevance
       FROM search.search_document d WHERE ${where}
       ORDER BY relevance DESC, d.updated_at DESC, d.product_id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const prices = priceRows[0] ?? {};
    return {
      items: items.map((item: Record<string, unknown>) => ({
        ...item,
        productId: String(item.productId),
        shopId: String(item.shopId),
        categoryId: item.categoryId == null ? null : String(item.categoryId),
        price: Number(item.price),
        relevance: Number(item.relevance),
      })) as SearchProductsPageDto['items'],
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      facets: {
        categories: facetRows.map(
          (row: { categoryId: unknown; count: unknown }) => ({
            categoryId: String(row.categoryId),
            count: Number(row.count),
          }),
        ),
        minPrice: prices.minPrice == null ? null : Number(prices.minPrice),
        maxPrice: prices.maxPrice == null ? null : Number(prices.maxPrice),
      },
    };
  }
}

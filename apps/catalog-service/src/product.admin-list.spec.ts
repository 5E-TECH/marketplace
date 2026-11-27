import { DataSource, QueryResult } from 'typeorm';
import { of } from 'rxjs';
import { AdminProductsQueryDto, ProductStatus } from '@app/common';
import { ProductService } from './product.service';
import { Product } from './entities/product.entity';
import { Shop } from './entities/shop.entity';
import { Category } from './entities/category.entity';
import { ProductVariant } from './entities/product-variant.entity';

class MetadataDataSource extends DataSource {
  async prepareMetadata() {
    await this.buildMetadatas();
  }
}

describe('ProductService admin list SQL', () => {
  it('builds joined pagination using actual entity metadata', async () => {
    // Run the real TypeORM query builder; only database I/O is stubbed.
    const source = new MetadataDataSource({
      type: 'postgres',
      entities: [Product, Shop, Category, ProductVariant],
    });
    await source.prepareMetadata();
    const runner = source.createQueryRunner();
    const result = new QueryResult();
    result.records = [];
    const query = jest.spyOn(runner, 'query').mockResolvedValue(result);
    jest.spyOn(source, 'createQueryRunner').mockReturnValue(runner);
    const service = new ProductService(
      source.getRepository(Product),
      source.getRepository(Shop),
      source.getRepository(Category),
      source.getRepository(ProductVariant),
      { emit: () => of(undefined) } as any,
      { emit: () => of(undefined) } as any,
    );

    await expect(
      service.adminList(new AdminProductsQueryDto()),
    ).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
    expect(query.mock.calls[0][0]).toContain('SELECT DISTINCT');
    expect(query.mock.calls[0][0]).toContain('"product_created_at" DESC');
    expect(query.mock.calls[0][0]).toContain('LIMIT 20');

    // BE-25 (FE-25): «To‘xtatilgan» (blocked=true, holatsiz) — arxivdagisiz; `status=ARCHIVED` — faqat arxiv
    query.mockClear();
    await service.adminList(
      Object.assign(new AdminProductsQueryDto(), { blocked: true }),
    );
    expect(query.mock.calls[0][0]).toContain('"product"."status" <> $');
    expect(query.mock.calls[0][1]).toContain(ProductStatus.ARCHIVED);
    query.mockClear();
    await service.adminList(
      Object.assign(new AdminProductsQueryDto(), {
        status: ProductStatus.ARCHIVED,
      }),
    );
    expect(query.mock.calls[0][0]).not.toContain('<>');
    expect(query.mock.calls[0][1]).toContain(ProductStatus.ARCHIVED);

    // BE-25 (FE-12): kategoriya, kanal, «Diqqat» (ID lar), nomi yoki slug
    query.mockClear();
    await service.adminList(
      Object.assign(new AdminProductsQueryDto(), {
        categoryId: '3',
        cpaEnabled: false,
        search: '50%_off',
      }),
      { ids: ['7', '9'] },
    );
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('"product"."category_id" = $');
    expect(sql).toContain('"product"."cpa_enabled" = $');
    expect(sql).toContain('"product"."id" IN (');
    expect(sql).toContain('"product"."slug" ILIKE $');
    expect(params).toEqual(
      expect.arrayContaining(['3', false, '7', '9', '%50\\%\\_off%']),
    );
    // «Diqqat» filtri bo‘sh — bazaga so‘rov yo‘q
    query.mockClear();
    await expect(
      service.adminList(new AdminProductsQueryDto(), { ids: [] }),
    ).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
    expect(query).not.toHaveBeenCalled();
  });
});

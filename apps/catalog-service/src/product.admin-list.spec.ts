import { DataSource, QueryResult } from 'typeorm';
import { of } from 'rxjs';
import { AdminProductsQueryDto } from '@app/common';
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
  });
});

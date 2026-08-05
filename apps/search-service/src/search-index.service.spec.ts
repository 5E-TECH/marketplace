import { BadRequestException } from '@nestjs/common';
import { SearchIndexService } from './search-index.service';

describe('SearchIndexService', () => {
  let documents: { create: jest.Mock; upsert: jest.Mock; delete: jest.Mock };
  let dataSource: { query: jest.Mock };
  let service: SearchIndexService;

  beforeEach(() => {
    documents = {
      create: jest.fn((value) => value),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = { query: jest.fn() };
    service = new SearchIndexService(documents as never, dataSource as never);
  });

  it('TC1: qidiruv natijasini relevantlik bo‘yicha so‘raydi', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([{ categoryId: '7', count: 2 }])
      .mockResolvedValueOnce([{ minPrice: '100', maxPrice: '500' }])
      .mockResolvedValueOnce([
        {
          productId: '2',
          shopId: '5',
          categoryId: '7',
          title: 'Telefon Pro',
          price: '500',
          relevance: '0.9',
        },
        {
          productId: '1',
          shopId: '5',
          categoryId: '7',
          title: 'Telefon g‘ilofi',
          price: '100',
          relevance: '0.4',
        },
      ]);

    const result = await service.search({
      q: 'telefon',
      page: 1,
      limit: 20,
    });

    expect(dataSource.query.mock.calls[3][0]).toContain(
      'ORDER BY relevance DESC',
    );
    expect(result.items.map((item) => item.productId)).toEqual(['2', '1']);
    expect(result.facets).toEqual({
      categories: [{ categoryId: '7', count: 2 }],
      minPrice: 100,
      maxPrice: 500,
    });
  });

  it('TC2: kategoriya va narx facet filtrlari natijani toraytiradi', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ categoryId: '9', count: 1 }])
      .mockResolvedValueOnce([{ minPrice: '200', maxPrice: '200' }])
      .mockResolvedValueOnce([]);

    await service.search({
      q: 'telefon',
      categoryId: '9',
      minPrice: 100,
      maxPrice: 300,
      page: 2,
      limit: 10,
    });

    const listCall = dataSource.query.mock.calls[3];
    expect(listCall[0]).toContain('d.category_id = $2');
    expect(listCall[0]).toContain('d.price >= $3');
    expect(listCall[0]).toContain('d.price <= $4');
    expect(listCall[1]).toEqual(['telefon', '9', 100, 300, 10, 10]);
  });

  it('noto‘g‘ri narx oralig‘ini rad etadi', async () => {
    await expect(
      service.search({
        q: 'telefon',
        minPrice: 500,
        maxPrice: 100,
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC3: yangi active mahsulotni indeksga upsert qiladi', async () => {
    await service.reindex({
      productId: '12',
      shopId: '5',
      categoryId: '7',
      title: 'Telefon',
      content: 'Yangi telefon',
      slug: 'telefon',
      imageUrl: null,
      shopName: 'Ali Market',
      price: 500,
      attributes: { brand: 'Elchi' },
      active: true,
    });

    expect(documents.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ productId: '12', title: 'Telefon' }),
      ['productId'],
    );
  });

  it('inactive yoki o‘chirilgan mahsulotni indeksdan chiqaradi', async () => {
    await service.reindex({
      productId: '12',
      shopId: '5',
      categoryId: null,
      title: 'Draft',
      content: null,
      slug: 'draft',
      imageUrl: null,
      shopName: '',
      price: 0,
      attributes: {},
      active: false,
    });
    expect(documents.delete).toHaveBeenCalledWith({ productId: '12' });
    expect(documents.upsert).not.toHaveBeenCalled();
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationTemplateService } from './notification-template.service';

function setup(
  rows: Array<{
    key: string;
    title: string;
    body: string;
    updatedAt: Date;
  }> = [],
) {
  const repo = {
    find: jest.fn().mockResolvedValue(rows),
    findOneBy: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({
      ...value,
      updatedAt: new Date('2026-09-24T10:00:00Z'),
    })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  return { service: new NotificationTemplateService(repo as never), repo };
}

describe('NotificationTemplateService (C6.8)', () => {
  it('TC1: barcha shablonlar — tahrirlangani ustun, qolgani standart', async () => {
    const { service } = setup([
      {
        key: 'shop_approved',
        title: 'Tabriklaymiz',
        body: '{shopName}!',
        updatedAt: new Date('2026-09-24T10:00:00Z'),
      },
    ]);

    const list = await service.list();

    expect(list.map((row) => row.key)).toEqual([
      'register',
      'shop_approved',
      'shop_rejected',
      'product_hidden',
      'order_created',
      'order_cancelled',
      'order_refunded',
    ]);
    expect(list.find((row) => row.key === 'shop_approved')).toMatchObject({
      title: 'Tabriklaymiz',
      customized: true,
      defaultTitle: 'Do‘kon tasdiqlandi',
      variables: { shopName: 'Do‘kon nomi' },
      updatedAt: '2026-09-24T10:00:00.000Z',
    });
    expect(list.find((row) => row.key === 'register')).toMatchObject({
      customized: false,
      updatedAt: null,
    });
  });

  it('tahrirda faqat ruxsat etilgan o‘zgaruvchilar — boshqasi 400', async () => {
    const { service, repo } = setup();

    await expect(
      service.update('shop_approved', {
        title: 'Salom',
        body: '{shopName} {phone} {x}',
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'Noma’lum o‘zgaruvchi: {phone}, {x}. Mumkin: {shopName}',
      ),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it.each(['{{shopName}} faol', '{shopName faol', 'Faol }', '{shop Name}'])(
    'ortiqcha qavs xabarni buzmasin — 400: %s',
    async (body) => {
      const { service, repo } = setup();
      await expect(
        service.update('shop_approved', { title: 'Salom', body }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    },
  );

  it('tahrir saqlanadi (bo‘shliqlar olinadi), kim o‘zgartirgani yoziladi', async () => {
    const { service, repo } = setup();

    const result = await service.update(
      'shop_approved',
      { title: '  Tabriklaymiz ', body: ' {shopName} sotuvda ' },
      '1',
    );

    expect(repo.save).toHaveBeenCalledWith({
      key: 'shop_approved',
      title: 'Tabriklaymiz',
      body: '{shopName} sotuvda',
      updatedBy: '1',
    });
    expect(result).toMatchObject({
      customized: true,
      body: '{shopName} sotuvda',
    });
  });

  it('noma’lum shablon — 404; standartga qaytarish yozuvni o‘chiradi', async () => {
    const { service, repo } = setup();
    await expect(
      service.update('nope', { title: 'a', body: 'b' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reset('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await expect(service.reset('shop_approved')).resolves.toMatchObject({
      customized: false,
      title: 'Do‘kon tasdiqlandi',
    });
    expect(repo.delete).toHaveBeenCalledWith({ key: 'shop_approved' });
  });

  it('render: qiymati yo‘q o‘zgaruvchi bo‘sh satr', async () => {
    const { service, repo } = setup();
    repo.findOneBy.mockResolvedValue(null);
    await expect(
      service.render('product_hidden', { productName: 'Telefon' }),
    ).resolves.toEqual({
      title: 'Mahsulot yashirildi',
      body: 'Telefon mahsulotingiz ko‘rinishdan olib tashlandi. Sabab: ',
    });
  });
});

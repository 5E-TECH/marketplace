import { ProductStatus } from '@app/common';
import { ADMIN_PRODUCTS_PAGE_EXAMPLE } from '../admin/admin-m1.examples';

/**
 * BE-25 (QA 2026-11-23, 2-tur): optovik kabineti javob misollari (BE-30). catalog `wholesaler-cabinet.service.ts`:
 * `createProduct`, `getProduct` va `listProducts` mahsulot qatorini (`Product`, `shop` bog‘lanishisiz) qaytaradi —
 * admin ro‘yxatidagi qator bilan bir xil maydonlar. Taklif qilingan mahsulot admin tasdig‘igacha `PENDING_REVIEW`,
 * `price` = bazaviy narx; sotuvchi haqi (A) va sotuv narxini admin belgilaydi (`product.service.ts` `createForShop`).
 */
const { shop: _shop, ...ADMIN_PRODUCT_ROW } =
  ADMIN_PRODUCTS_PAGE_EXAMPLE.items[0];

export const WHOLESALER_PRODUCT_EXAMPLE = {
  ...ADMIN_PRODUCT_ROW,
  status: ProductStatus.PENDING_REVIEW,
  // rasm majburiy (`createForShop`): `imageUrl` — birinchi rasm, `images` — galereya
  imageUrl:
    'https://api.elchimarket.uz/media/marketplace-media/products/1764000000000-uuid.jpg',
  images: [
    'https://api.elchimarket.uz/media/marketplace-media/products/1764000000000-uuid.jpg',
  ],
  price: ADMIN_PRODUCT_ROW.basePrice,
  affiliateFee: null,
  approvedPrice: null,
  priceStatus: null,
  updatedAt: ADMIN_PRODUCT_ROW.createdAt,
};

export const WHOLESALER_PRODUCTS_PAGE_EXAMPLE = {
  items: [WHOLESALER_PRODUCT_EXAMPLE],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

import type { DatabaseDefinition } from '@app/common';
import { FixProductStatusDefault1795910400000 } from './migrations/1795910400000-fix-product-status-default';
import { WholesalerCpaProduct1796083200000 } from './migrations/1796083200000-wholesaler-cpa-product';
import { Pricing1796169600000 } from './migrations/1796169600000-pricing';
import { ProductFiscalCodes1797033600000 } from './migrations/1797033600000-product-fiscal-codes';
import {
  ElchiTariffEntity,
  PriceDecision,
  PricePolicy,
} from './entities/pricing.entity';
import { CreateCatalogTables1721736000000 } from './migrations/1721736000000-create-catalog-tables';
import { DefaultProductActive1724414400000 } from './migrations/1724414400000-default-product-active';
import { CreateFavorites1723300000000 } from './migrations/1723300000000-create-favorites';
import { AddGuestFavorites1724500800000 } from './migrations/1724500800000-add-guest-favorites';
import { CreateReviews1724846400000 } from './migrations/1724846400000-create-reviews';
import { AddProductModeration1725105600000 } from './migrations/1725105600000-add-product-moderation';
import { AddShopFeatured1725192000000 } from './migrations/1725192000000-add-shop-featured';
import { AddShopTariffs1725372000000 } from './migrations/1725372000000-add-shop-tariffs';
import { CreateBanners1726588800000 } from './migrations/1726588800000-create-banners';
import { MoneyToBigint1795219200000 } from './migrations/1795219200000-money-to-bigint';
import { Shop } from './entities/shop.entity';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { Favorite } from './entities/favorite.entity';
import { Review } from './entities/review.entity';
import { Banner } from './entities/banner.entity';

/**
 * catalog-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`catalog.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const CATALOG_DB: DatabaseDefinition = {
  schema: 'catalog',
  entities: [
    Shop,
    Category,
    Product,
    ProductVariant,
    Favorite,
    Review,
    Banner,
    PricePolicy,
    ElchiTariffEntity,
    PriceDecision,
  ],
  migrations: [
    CreateCatalogTables1721736000000,
    DefaultProductActive1724414400000,
    CreateFavorites1723300000000,
    AddGuestFavorites1724500800000,
    CreateReviews1724846400000,
    AddProductModeration1725105600000,
    AddShopFeatured1725192000000,
    AddShopTariffs1725372000000,
    CreateBanners1726588800000,
    MoneyToBigint1795219200000,
    FixProductStatusDefault1795910400000,
    WholesalerCpaProduct1796083200000,
    Pricing1796169600000,
    ProductFiscalCodes1797033600000,
  ],
};

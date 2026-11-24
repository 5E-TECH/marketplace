import { EntityManager } from 'typeorm';

/** Toifa belgilari, ota toifadan meros hisobga olingan. */
export interface CategoryFlags {
  /** BAD toifasi (TZ 8): mahsulotida «Dori vositasi emas». */
  isBad: boolean;
  /** Postavkada partiya muddati kuzatiladi (TZ OMB-3: BAD, kosmetika, oziq-ovqat). */
  expiryTracked: boolean;
}

export interface CategoryFlagRow {
  id: string;
  parentId: string | null;
  isBad: boolean | null;
  expiryTracked: boolean | null;
}

const NONE: CategoryFlags = { isBad: false, expiryTracked: false };

/**
 * Har belgi alohida: toifaning o‘z qiymati, u NULL bo‘lsa — eng yaqin otadagi qiymat, hech qayerda yo‘q bo‘lsa — «yo‘q».
 * BAD toifasida muddat doim kuzatiladi (OMB-3).
 */
export function resolveCategoryFlags(
  rows: CategoryFlagRow[],
): (categoryId: string | null | undefined) => CategoryFlags {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const cache = new Map<string, CategoryFlags>();
  const inherited = (
    id: string,
    key: 'isBad' | 'expiryTracked',
  ): boolean | null => {
    const seen = new Set<string>();
    for (
      let row = byId.get(id);
      row && !seen.has(String(row.id));
      row = row.parentId ? byId.get(String(row.parentId)) : undefined
    ) {
      seen.add(String(row.id));
      if (row[key] !== null && row[key] !== undefined) return row[key];
    }
    return null;
  };
  return (categoryId) => {
    if (!categoryId) return NONE;
    const id = String(categoryId);
    let flags = cache.get(id);
    if (!flags) {
      const isBad = inherited(id, 'isBad') ?? false;
      flags = {
        isBad,
        expiryTracked: isBad || (inherited(id, 'expiryTracked') ?? false),
      };
      cache.set(id, flags);
    }
    return flags;
  };
}

/** Toifalar soni kichik (daraxt butunlay o‘qiladi); o‘chirilgan toifadagi mahsulot belgisi ham saqlanadi. */
export async function loadCategoryFlags(
  manager: EntityManager,
): Promise<(categoryId: string | null | undefined) => CategoryFlags> {
  const rows = (await manager.query(
    `SELECT id::text AS id, parent_id::text AS "parentId", is_bad AS "isBad", expiry_tracked AS "expiryTracked"
       FROM catalog.category`,
  )) as CategoryFlagRow[];
  return resolveCategoryFlags(rows);
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * BE-25 (TC1): docs/openapi.json tuzilishi. Fayl o‘zi koddan yaratiladi va CI da eskirmagani tekshiriladi
 * (`contract:export`), shuning uchun bu yerda tayyor fayl o‘qiladi.
 */
type Json = Record<string, unknown>;
const doc = JSON.parse(
  readFileSync(resolve(__dirname, '../../../docs/openapi.json'), 'utf8'),
) as {
  paths: Record<string, Record<string, Json>>;
  components: { schemas: Record<string, Json> };
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;

/** Hozircha doim `null` keladigan maydonlar — tuzilishi yo‘q. */
const ALWAYS_NULL = [
  '/components/schemas/AffiliateOfferDetailDto/properties/results',
  '/components/schemas/AffiliateOfferDetailDto/properties/priceSplit',
  '/components/schemas/AffiliateProfileDto/properties/card',
  '/components/schemas/LogoutSuccessResponseDto/properties/data',
];

function visit(
  node: unknown,
  path: string,
  each: (node: Json, path: string) => void,
): void {
  if (!isObject(node)) return;
  each(node, path);
  for (const [key, value] of Object.entries(node))
    if (key !== 'example' && key !== 'examples')
      visit(value, `${path}/${key}`, each);
}

describe('docs/openapi.json (BE-25)', () => {
  it('maydon turi bo‘sh `object` emas: `T | null` da tur ko‘rsatiladi, aks holda frontendda Record<string, never>', () => {
    const empty: string[] = [];
    visit(doc, '', (node, path) => {
      if (
        node.type === 'object' &&
        Object.keys((node.properties as Json | undefined) ?? {}).length === 0 &&
        node.additionalProperties === undefined &&
        !node.allOf &&
        !node.oneOf
      )
        empty.push(path);
    });
    expect(empty.sort()).toEqual([...ALWAYS_NULL].sort());
  });

  it('yo‘ldagi har {parametr} e’lon qilingan', () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(doc.paths))
      for (const method of METHODS) {
        const operation = item[method];
        if (!operation) continue;
        const declared = (
          [
            ...((item.parameters as unknown as Json[]) ?? []),
            ...((operation.parameters as Json[]) ?? []),
          ] as Array<{ in?: string; name?: string }>
        )
          .filter((p) => p.in === 'path')
          .map((p) => p.name);
        for (const [, name] of path.matchAll(/\{([^}]+)\}/g))
          if (!declared.includes(name))
            missing.push(`${method} ${path} {${name}}`);
      }
    expect(missing).toEqual([]);
  });

  it('hamma $ref topiladi, operationId takrorlanmaydi', () => {
    const broken: string[] = [];
    visit(doc, '', (node, path) => {
      if (typeof node.$ref !== 'string') return;
      const name = node.$ref.replace('#/components/schemas/', '');
      if (!doc.components.schemas[name]) broken.push(`${path} → ${node.$ref}`);
    });
    expect(broken).toEqual([]);

    const ids = Object.values(doc.paths).flatMap((item) =>
      METHODS.filter((m) => item[m]).map((m) => String(item[m].operationId)),
    );
    expect(ids.length).toBeGreaterThan(200);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

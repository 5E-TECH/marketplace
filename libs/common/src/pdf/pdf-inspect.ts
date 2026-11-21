import { inflateSync } from 'zlib';

/**
 * Testlar uchun: pdfkit yozgan PDF dan matn va shrift nomlarini o‘qiydi.
 * pdfkit matnni glyf raqamlari bilan yozadi — baytlarda «Витамин» bo‘lmaydi. Matn sahifa oqimidagi glyflardan
 * shriftning ToUnicode jadvali orqali tiklanadi: glyfi yo‘q harf (.notdef) jadvalga tushmaydi va matnda chiqmaydi.
 * Faqat pdfkit chiqishi uchun (to‘g‘ridan-to‘g‘ri obyektlar, `/Length` raqam); umumiy PDF parser emas.
 */
export interface PdfInspection {
  /** Sahifalar matni: har `BT … ET` bloki — alohida qator. */
  text: string;
  /** Joylangan shriftlar (`/BaseFont`), masalan `ABCDEF+DejaVuSansCondensed`. */
  fonts: string[];
}

interface PdfObject {
  dict: string;
  stream?: Buffer;
}

export function inspectPdf(pdf: Buffer): PdfInspection {
  const objects = parseObjects(pdf);
  // Type0 shrift va uning CIDFont avlodi bir xil `/BaseFont` ga ega — bir marta.
  const fonts = [
    ...new Set(
      [...objects.values()]
        .filter((o) => /\/Type\s*\/Font\b/.test(o.dict))
        .map((o) => /\/BaseFont\s*\/([^\s/>]+)/.exec(o.dict)?.[1])
        .filter((name): name is string => name !== undefined),
    ),
  ];

  const toUnicode = new Map<string, Map<number, string>>();
  const fontCmap = (resource: string, ref: number) => {
    const font = objects.get(ref);
    const cmapRef = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font?.dict ?? '');
    const cmap = cmapRef ? objects.get(Number(cmapRef[1]))?.stream : undefined;
    if (!cmap) {
      const base = /\/BaseFont\s*\/([^\s/>]+)/.exec(font?.dict ?? '')?.[1];
      throw new Error(
        `${resource} (${base ?? ref}) shriftida ToUnicode yo‘q — standart shrift (Helvetica) ishlatilgan`,
      );
    }
    return parseCmap(cmap.toString('latin1'));
  };

  const lines: string[] = [];
  for (const page of pageOrder(objects)) {
    const dict = objects.get(page)?.dict ?? '';
    const resources = resolveDict(objects, dict, 'Resources');
    const fontDict = resolveDict(objects, resources, 'Font');
    const fontRefs = new Map<string, number>();
    for (const m of fontDict.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
      fontRefs.set(m[1], Number(m[2]));
    }
    for (const contentRef of refs(dict, 'Contents')) {
      const content = objects.get(contentRef)?.stream?.toString('latin1');
      if (!content) continue;
      let cmap: Map<number, string> | undefined;
      let line = '';
      for (const m of content.matchAll(
        /\/(\w+)\s+[-\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj|\bET\b/g,
      )) {
        if (m[1] !== undefined) {
          const ref = fontRefs.get(m[1]);
          if (ref === undefined)
            throw new Error(`Shrift resursi yo‘q: ${m[1]}`);
          const key = `${page}:${m[1]}`;
          if (!toUnicode.has(key)) toUnicode.set(key, fontCmap(m[1], ref));
          cmap = toUnicode.get(key);
        } else if (m[2] !== undefined) {
          for (const s of m[2].matchAll(/<([0-9a-fA-F]*)>/g)) {
            line += decodeGlyphs(s[1], cmap);
          }
        } else if (m[3] !== undefined) {
          line += decodeGlyphs(m[3], cmap);
        } else {
          lines.push(line);
          line = '';
        }
      }
    }
  }
  return { text: lines.join('\n'), fonts };
}

function decodeGlyphs(hex: string, cmap: Map<number, string> | undefined) {
  if (!cmap) throw new Error('Matn shriftsiz (Tf yo‘q)');
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += cmap.get(parseInt(hex.slice(i, i + 4), 16)) ?? '�';
  }
  return out;
}

/** `N 0 obj … endobj`; oqim `/Length` bo‘yicha kesiladi (ikkilik ma’lumotda «endobj» uchrasa ham adashmaydi). */
function parseObjects(pdf: Buffer): Map<number, PdfObject> {
  const raw = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const header = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = header.exec(raw))) {
    const start = m.index + m[0].length;
    const streamAt = raw.indexOf('stream', start);
    const endAt = raw.indexOf('endobj', start);
    if (streamAt !== -1 && streamAt < endAt) {
      const dict = raw.slice(start, streamAt);
      const length = Number(/\/Length\s+(\d+)/.exec(dict)?.[1]);
      const dataStart =
        raw[streamAt + 6] === '\r' ? streamAt + 8 : streamAt + 7;
      let stream: Buffer = pdf.subarray(dataStart, dataStart + length);
      if (/\/Filter\s*\/FlateDecode/.test(dict)) stream = inflateSync(stream);
      objects.set(Number(m[1]), { dict, stream });
      header.lastIndex = raw.indexOf('endobj', dataStart + length);
    } else {
      objects.set(Number(m[1]), { dict: raw.slice(start, endAt) });
      header.lastIndex = endAt;
    }
  }
  return objects;
}

/** `/Pages` → `/Kids` tartibida sahifa obyektlari. */
function pageOrder(objects: Map<number, PdfObject>): number[] {
  const root = [...objects.values()].find((o) =>
    /\/Type\s*\/Pages\b/.test(o.dict),
  );
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(root?.dict ?? '')?.[1] ?? '';
  return [...kids.matchAll(/(\d+)\s+0\s+R/g)].map((k) => Number(k[1]));
}

function refs(dict: string, key: string): number[] {
  const value = new RegExp(`/${key}\\s*(\\[[^\\]]*\\]|\\d+\\s+0\\s+R)`).exec(
    dict,
  )?.[1];
  return [...(value ?? '').matchAll(/(\d+)\s+0\s+R/g)].map((r) => Number(r[1]));
}

/** `/Key N 0 R` yoki ichki `/Key << … >>` — lug‘at matni. */
function resolveDict(
  objects: Map<number, PdfObject>,
  dict: string,
  key: string,
): string {
  const ref = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  if (ref) return objects.get(Number(ref[1]))?.dict ?? '';
  const at = dict.search(new RegExp(`/${key}\\s*<<`));
  if (at === -1) return '';
  let depth = 0;
  const open = dict.indexOf('<<', at);
  for (let i = open; i < dict.length - 1; i++) {
    if (dict.startsWith('<<', i)) {
      depth++;
      i++;
    } else if (dict.startsWith('>>', i)) {
      depth--;
      i++;
      if (depth === 0) return dict.slice(open, i + 1);
    }
  }
  return '';
}

/** ToUnicode CMap: `bfrange` (massiv va ketma-ket) va `bfchar`. */
function parseCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of block[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F\s]*>)/g,
    )) {
      const from = parseInt(r[1], 16);
      const to = parseInt(r[2], 16);
      if (r[3].startsWith('[')) {
        let code = from;
        for (const dst of r[3].matchAll(/<([0-9a-fA-F\s]*)>/g)) {
          map.set(code++, utf16be(dst[1]));
        }
      } else {
        const base = utf16be(r[3].slice(1, -1));
        for (let code = from; code <= to; code++) {
          map.set(
            code,
            base.slice(0, -1) +
              String.fromCharCode(
                base.charCodeAt(base.length - 1) + code - from,
              ),
          );
        }
      }
    }
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const c of block[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F\s]*)>/g,
    )) {
      map.set(parseInt(c[1], 16), utf16be(c[2]));
    }
  }
  return map;
}

function utf16be(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  const units: number[] = [];
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    units.push(parseInt(clean.slice(i, i + 4), 16));
  }
  return String.fromCharCode(...units);
}

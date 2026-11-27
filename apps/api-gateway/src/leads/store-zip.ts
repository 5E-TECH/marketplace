import { Readable } from 'stream';

/**
 * BE-25 (FE-05): siqmasdan (STORE) ZIP — kreativlar (video, rasm) allaqachon siqilgan. Kutubxonasiz: fayllar navbat
 * bilan bittadan oqim qilib o‘qiladi (xotiraga yig‘ilmaydi), uzunlik oldindan aniq (`Content-Length`).
 *
 * Har yozuv: lokal sarlavha (CRC va hajm — keyin, 3-bit) → ma’lumot → data descriptor; oxirida markaziy katalog va
 * EOCD. Nomlar UTF-8 (11-bit). ZIP64 yo‘q — jami 4 GiB dan katta bo‘lsa xato (20 × 100 MB < 4 GiB).
 */
export interface ZipEntry {
  name: string;
  /** Aniq hajm (bayt) — oqim boshqacha bo‘lsa, arxiv uziladi. */
  size: number;
  open: () => Promise<NodeJS.ReadableStream>;
}

const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** 3-bit: CRC va hajm data descriptor da; 11-bit: nom UTF-8 da. */
const FLAGS = 0x0808;
const VERSION = 20;
const MAX_32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), bo‘laklab: `crc32(b, crc32(a))` = `crc32(a + b)`. */
export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;
  for (let i = 0; i < data.length; i++)
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

/** Arxiv hajmi, bayt — `Content-Length` uchun. */
export function zipLength(
  entries: Array<Pick<ZipEntry, 'name' | 'size'>>,
): number {
  let total = 22;
  for (const e of entries) {
    const name = Buffer.byteLength(e.name, 'utf8');
    total += 30 + name + e.size + 16 + 46 + name;
  }
  return total;
}

/** Arxiv chegaradan oshmaydimi (ZIP64 siz). */
export function zipFits(
  entries: Array<Pick<ZipEntry, 'name' | 'size'>>,
): boolean {
  return entries.length <= MAX_ENTRIES && zipLength(entries) <= MAX_32;
}

function dosTime(date: Date): { time: number; date: number } {
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date:
      ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

/** Arxiv oqimi; xato (fayl o‘qilmasa, hajm mos kelmasa) — oqim xato bilan to‘xtaydi. */
export function zipStream(entries: ZipEntry[], at = new Date()): Readable {
  if (!zipFits(entries))
    throw new Error('ZIP chegarasi (4 GiB yoki 65 535 fayl) oshdi');
  const stamp = dosTime(at);
  /** O‘qilayotgan fayl oqimi — mijoz uzilsa yopiladi (MinIO ulanishi osilib qolmasin). */
  let current: NodeJS.ReadableStream | null = null;
  async function* generate(): AsyncGenerator<Buffer> {
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(LOCAL, 0);
      local.writeUInt16LE(VERSION, 4);
      local.writeUInt16LE(FLAGS, 6);
      local.writeUInt16LE(0, 8); // STORE
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      // 14–25: CRC va hajmlar — data descriptor da
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      yield Buffer.concat([local, name]);

      let crc = 0;
      let size = 0;
      current = await entry.open();
      for await (const chunk of current) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        crc = crc32(data, crc);
        size += data.length;
        if (size > entry.size)
          throw new Error(`${entry.name}: hajm kutilganidan katta`);
        yield data;
      }
      if (size !== entry.size)
        throw new Error(
          `${entry.name}: hajm ${size}, kutilgan ${entry.size} bayt`,
        );
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DESCRIPTOR, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      yield descriptor;

      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL, 0);
      header.writeUInt16LE(VERSION, 4);
      header.writeUInt16LE(VERSION, 6);
      header.writeUInt16LE(FLAGS, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(stamp.time, 12);
      header.writeUInt16LE(stamp.date, 14);
      header.writeUInt32LE(crc, 16);
      header.writeUInt32LE(size, 20);
      header.writeUInt32LE(size, 24);
      header.writeUInt16LE(name.length, 28);
      // 30–41: qo‘shimcha, izoh, disk, atributlar — 0
      header.writeUInt32LE(offset, 42);
      central.push(Buffer.concat([header, name]));
      offset += 30 + name.length + size + 16;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    yield Buffer.concat([directory, end]);
  }
  const readable = Readable.from(generate(), { objectMode: false });
  // `destroy` generator tugashini kutadi, generator esa fayl oqimini kutib turgan bo‘lishi mumkin — avval faylni yopamiz
  const destroy = readable._destroy.bind(readable);
  readable._destroy = (error, callback) => {
    const source = current as
      (NodeJS.ReadableStream & { destroy?: () => void }) | null;
    source?.destroy?.();
    destroy(error, callback);
  };
  return readable;
}

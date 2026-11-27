import { Readable } from 'stream';
import { crc32, ZipEntry, zipLength, zipStream } from './store-zip';

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Markaziy katalog orqali o‘qiydi (ZIP o‘quvchilar kabi) va har faylning CRC ini qayta hisoblaydi. */
function readZip(zip: Buffer) {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  const size = zip.readUInt32LE(end + 12);
  let at = zip.readUInt32LE(end + 16);
  expect(at + size).toBe(end);
  const files: Array<{ name: string; data: Buffer; flags: number }> = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const flags = zip.readUInt16LE(at + 8);
    const crc = zip.readUInt32LE(at + 16);
    const length = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    expect(zip.readUInt16LE(offset + 8)).toBe(0); // STORE
    const start = offset + 30 + zip.readUInt16LE(offset + 26);
    const data = zip.subarray(start, start + length);
    expect(crc32(data)).toBe(crc);
    // data descriptor
    expect(zip.readUInt32LE(start + length)).toBe(0x08074b50);
    expect(zip.readUInt32LE(start + length + 4)).toBe(crc);
    files.push({ name, data, flags });
    at += 46 + nameLength;
  }
  return files;
}

const entry = (name: string, data: Buffer, chunk = 7): ZipEntry => ({
  name,
  size: data.length,
  open: async () => {
    const parts: Buffer[] = [];
    for (let i = 0; i < data.length; i += chunk)
      parts.push(data.subarray(i, i + chunk));
    return Readable.from(parts);
  },
});

describe('store-zip (BE-25, FE-05 kreativlar ZIP)', () => {
  it('CRC-32: tekshiruv qiymatlari; bo‘laklab hisoblash bir xil', () => {
    expect(crc32(Buffer.from('hello'))).toBe(0x3610a686);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from('6789'), crc32(Buffer.from('12345')))).toBe(
      0xcbf43926,
    );
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it('arxiv: uzunlik oldindan aniq, nomlar UTF-8, fayllar va CRC to‘g‘ri, bo‘sh fayl ham', async () => {
    const video = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    const image = Buffer.from('rasm — ʻoʼzbekcha');
    const entries = [
      entry('01-video.mp4', video),
      entry('02-rasm.jpg', image, 3),
      entry('03-bo‘sh.txt', Buffer.alloc(0)),
    ];
    const zip = await collect(zipStream(entries));
    expect(zip.length).toBe(zipLength(entries));
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual([
      '01-video.mp4',
      '02-rasm.jpg',
      '03-bo‘sh.txt',
    ]);
    expect(files[0].data.equals(video)).toBe(true);
    expect(files[1].data.equals(image)).toBe(true);
    expect(files[2].data.length).toBe(0);
    // 3-bit (data descriptor) va 11-bit (UTF-8)
    expect(files.every((f) => f.flags === 0x0808)).toBe(true);
  });

  it('fayl hajmi kutilganidan farq qilsa — oqim xato bilan to‘xtaydi (yarim arxiv to‘liq bo‘lib ko‘rinmaydi)', async () => {
    const short = { ...entry('01-video.mp4', Buffer.from('abc')), size: 5 };
    await expect(collect(zipStream([short]))).rejects.toThrow(/kutilgan 5/);
    const long = { ...entry('01-video.mp4', Buffer.from('abcdef')), size: 2 };
    await expect(collect(zipStream([long]))).rejects.toThrow(/katta/);
  });

  it('4 GiB dan katta — ZIP64 yo‘q, boshidayoq rad etiladi', () => {
    expect(() =>
      zipStream([
        { name: 'a', size: 0xffffffff, open: async () => Readable.from([]) },
      ]),
    ).toThrow(/chegarasi/);
  });
});

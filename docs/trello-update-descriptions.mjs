// ============================================================================
// card-descriptions.mjs dagi sodda o'zbekcha tavsiflarni:
//   1) Trello cardlarga yozadi (desc yangilanadi — testlar checklistda qoladi),
//   2) trello-import.csv Description ustunini yangilaydi (tavsif + "|| TEST:" saqlanadi).
//   TRELLO_KEY=.. TRELLO_TOKEN=.. TRELLO_BOARD_ID=683723494d29ae9b65efafcc \
//     node docs/trello-update-descriptions.mjs docs/trello-import.csv
// ============================================================================
import descriptions from './card-descriptions.mjs';
const KEY = process.env.TRELLO_KEY, TOKEN = process.env.TRELLO_TOKEN, BOARD_ID = process.env.TRELLO_BOARD_ID;
const CSV_PATH = process.argv[2] || 'docs/trello-import.csv';
if (!KEY || !TOKEN || !BOARD_ID) { console.error('❌ TRELLO_KEY/TOKEN/BOARD_ID env kerak'); process.exit(1); }

const auth = `key=${KEY}&token=${TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.trello.com/1${path}${sep}${auth}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  await sleep(110); return res.json();
}
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQ) { if (c === '"' && n === '"') { field += '"'; i++; } else if (c === '"') inQ = false; else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && n === '\n') i++; if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; } }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return { header, rows: rows.map((r) => header.map((_, i) => r[i] ?? '')) , objs: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '')]))) };
}
function csvField(v) {
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function extractTests(desc) {
  const i = desc.indexOf('|| TEST:');
  return i === -1 ? [] : desc.slice(i + 8).split(';').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const fs = await import('node:fs/promises');
  const { header, objs } = parseCSV(await fs.readFile(CSV_PATH, 'utf8'));
  const cards = await api('GET', `/boards/${BOARD_ID}/cards?fields=name`);
  const idByName = new Map(cards.map((c) => [c.name, c.id]));

  let ok = 0, miss = 0;
  const outRows = [];
  for (const r of objs) {
    const name = r['Card Name'];
    const code = name.split(' ')[0];               // "C0.1 ..." -> "C0.1"
    const newDesc = descriptions[code];
    const tests = extractTests(r['Description'] || '');
    if (newDesc) {
      const id = idByName.get(name);
      if (id) { await api('PUT', `/cards/${id}`, { desc: newDesc }); ok++; console.log(`✔ ${name}`); }
      else { miss++; console.log(`? card yo'q: ${name}`); }
      // CSV Description = yangi tavsif + testlar (checklist/import uchun saqlanadi)
      r['Description'] = newDesc + (tests.length ? ` || TEST: ${tests.join('; ')}` : '');
    } else { miss++; console.log(`? tavsif yo'q (kod ${code}): ${name}`); }
    outRows.push(header.map((h) => csvField(r[h] ?? '')).join(','));
  }
  await fs.writeFile(CSV_PATH, header.join(',') + '\n' + outRows.join('\n') + '\n', 'utf8');
  console.log(`\n✅ Trello yangilandi: ${ok} card. CSV qayta yozildi. Muammo: ${miss}.`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });

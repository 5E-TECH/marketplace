// ============================================================================
// Har cardga "🧪 Test (Done'dan oldin)" checklist qo'shadi.
// Punktlar = CSV description'idagi "|| TEST: TC1 ...; TC2 ..." dan olinadi.
// Maqsad: dasturchi har testni qo'lda bajarib ✓ belgilaydi; hammasi ✓ bo'lmaguncha
// card Done'ga o'tmasligi kerak (jamoa qoidasi).
//
//   TRELLO_KEY=.. TRELLO_TOKEN=.. TRELLO_BOARD_ID=683723494d29ae9b65efafcc \
//     node docs/trello-add-checklists.mjs docs/trello-import.csv
// Idempotent: shu nomli checklist allaqachon bor bo'lsa, o'sha card o'tkazib yuboriladi.
// ============================================================================
const KEY = process.env.TRELLO_KEY, TOKEN = process.env.TRELLO_TOKEN, BOARD_ID = process.env.TRELLO_BOARD_ID;
const CSV_PATH = process.argv[2] || 'docs/trello-import.csv';
const CHECKLIST_NAME = "🧪 Test (Done'dan oldin)";
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
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
// description'dan test punktlarini ajratish: "... || TEST: TC1 ..; TC2 .." -> ["TC1 ..","TC2 .."]
function extractTests(desc) {
  const idx = desc.indexOf('|| TEST:');
  if (idx === -1) return [];
  return desc.slice(idx + '|| TEST:'.length).split(';').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const fs = await import('node:fs/promises');
  const rows = parseCSV(await fs.readFile(CSV_PATH, 'utf8'));
  const cards = await api('GET', `/boards/${BOARD_ID}/cards?fields=name`);
  const cardByName = new Map(cards.map((c) => [c.name, c.id]));

  let done = 0, skip = 0, items = 0, miss = 0;
  for (const r of rows) {
    const cardId = cardByName.get(r['Card Name']);
    if (!cardId) { miss++; console.log(`? card yo'q: ${r['Card Name']}`); continue; }
    const tests = extractTests(r['Description'] || '');
    if (!tests.length) { skip++; console.log(`· testsiz: ${r['Card Name']}`); continue; }

    const existing = await api('GET', `/cards/${cardId}/checklists?fields=name`);
    if (existing.some((cl) => cl.name === CHECKLIST_NAME)) { skip++; console.log(`↷ bor: ${r['Card Name']}`); continue; }

    const cl = await api('POST', `/checklists?idCard=${cardId}&name=${encodeURIComponent(CHECKLIST_NAME)}`);
    for (const t of tests) {
      await api('POST', `/checklists/${cl.id}/checkItems?name=${encodeURIComponent(t)}`);
      items++;
    }
    done++; console.log(`✔ ${r['Card Name']} — ${tests.length} test`);
  }
  console.log(`\n✅ Checklist qo'shildi: ${done} card, ${items} punkt. O'tkazildi: ${skip}, topilmadi: ${miss}.`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });

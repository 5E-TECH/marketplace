// ============================================================================
// trello-import.csv dagi "Members" ustuniga qarab har cardga a'zo biriktiradi.
// Import'dan KEYIN ishga tushiriladi (cardlar allaqachon board'da bo'lishi kerak).
//   TRELLO_KEY=.. TRELLO_TOKEN=.. TRELLO_BOARD_ID=683723494d29ae9b65efafcc \
//     node docs/trello-assign-members.mjs docs/trello-import.csv
// Idempotent: a'zo allaqachon biriktirilgan bo'lsa qayta qo'shmaydi.
// ============================================================================
const KEY = process.env.TRELLO_KEY, TOKEN = process.env.TRELLO_TOKEN, BOARD_ID = process.env.TRELLO_BOARD_ID;
const CSV_PATH = process.argv[2] || 'docs/trello-import.csv';
if (!KEY || !TOKEN || !BOARD_ID) { console.error('❌ TRELLO_KEY/TOKEN/BOARD_ID env kerak'); process.exit(1); }

// CSV "Members" nomi -> Trello username
const MEMBER_MAP = { Lead: 'shodiyorergashev', Dilshodbek: 'urozov04', Bahodir: 'nabijanov' };

const auth = `key=${KEY}&token=${TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.trello.com/1${path}${sep}${auth}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  await sleep(120); return res.json();
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

async function main() {
  const fs = await import('node:fs/promises');
  const rows = parseCSV(await fs.readFile(CSV_PATH, 'utf8'));

  const members = await api('GET', `/boards/${BOARD_ID}/members?fields=username`);
  const idByUsername = new Map(members.map((m) => [m.username, m.id]));
  const cards = await api('GET', `/boards/${BOARD_ID}/cards?fields=name,idMembers`);
  const cardByName = new Map(cards.map((c) => [c.name, c]));

  let ok = 0, skip = 0, miss = 0;
  for (const r of rows) {
    const card = cardByName.get(r['Card Name']);
    if (!card) { miss++; console.log(`? card topilmadi: ${r['Card Name']}`); continue; }
    const username = MEMBER_MAP[r['Members']];
    const memberId = username && idByUsername.get(username);
    if (!memberId) { miss++; console.log(`? a'zo topilmadi: ${r['Members']} (${r['Card Name']})`); continue; }
    if (card.idMembers?.includes(memberId)) { skip++; continue; }
    await api('POST', `/cards/${card.id}/idMembers`, { value: memberId });
    ok++; console.log(`✔ ${r['Members']} -> ${r['Card Name']}`);
  }
  console.log(`\n✅ Biriktirildi: ${ok}, allaqachon bor: ${skip}, topilmadi: ${miss}.`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });

// ============================================================================
// Trello CSV -> board importer (FREE plan, Trello REST API orqali)
// trello-import.csv dagi har qatorni to'liq card qilib yaratadi:
//   nom, izoh (test'lar bilan), label, due, to'g'ri list.
//
// ISHLATISH:
//   1) Kalit + token oling (bepul):
//        API key:  https://trello.com/power-ups/admin  -> New -> "API key"
//        Token:    o'sha sahifada "Token" havolasi -> Allow (read+write)
//   2) Env bering va ishga tushiring (Node 18+):
//        TRELLO_KEY=xxx TRELLO_TOKEN=yyy TRELLO_BOARD_ID=qmS9YsF6 \
//          node docs/trello-import.mjs docs/trello-import.csv
//
// XAVFSIZLIK: KEY/TOKEN maxfiy — git'ga commit QILMANG, faqat env orqali bering.
// Qayta ishga tushirsangiz dublikat yaratmaydi (bir xil nomli card o'tkazib yuboriladi).
// ============================================================================

const KEY = process.env.TRELLO_KEY;
const TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.TRELLO_BOARD_ID;
const CSV_PATH = process.argv[2] || 'docs/trello-import.csv';

if (!KEY || !TOKEN || !BOARD_ID) {
  console.error('❌ TRELLO_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID env kerak.');
  process.exit(1);
}

const auth = `key=${KEY}&token=${TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.trello.com/1${path}${sep}${auth}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  await sleep(120); // rate-limit'ga ehtiyot (Trello: ~100 req/10s)
  return res.json();
}

// ── minimal CSV parser (tirnoq ichidagi vergul/qatorni to'g'ri o'qiydi) ─────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && n === '\n') i++;
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// ── Trello label rangi (label nomiga ko'ra) ────────────────────────────────
function labelColor(name) {
  if (name.startsWith('Phase')) return 'purple';
  if (['Blocker', 'High'].includes(name)) return 'red';
  if (name === 'Normal') return 'yellow';
  if (['S', 'M', 'L', 'XL'].includes(name)) return 'sky';
  return 'green'; // Area (Backend-*, Frontend, DevOps, Elchi-Integration ...)
}

async function main() {
  const fs = await import('node:fs/promises');
  const rows = parseCSV(await fs.readFile(CSV_PATH, 'utf8'));
  console.log(`📄 ${rows.length} qator o'qildi.`);

  // mavjud list / label / card holatini bir marta olib kelamiz
  const lists = await api('GET', `/boards/${BOARD_ID}/lists`);
  const listByName = new Map(lists.map((l) => [l.name, l.id]));

  const labels = await api('GET', `/boards/${BOARD_ID}/labels`);
  const labelByName = new Map(labels.filter((l) => l.name).map((l) => [l.name, l.id]));

  const existingCards = await api('GET', `/boards/${BOARD_ID}/cards?fields=name`);
  const cardNames = new Set(existingCards.map((c) => c.name));

  let created = 0, skipped = 0;
  for (const r of rows) {
    const name = r['Card Name'];
    if (!name) continue;
    if (cardNames.has(name)) { skipped++; console.log(`↷ skip (bor): ${name}`); continue; }

    // list — TRELLO_TARGET_LIST bo'lsa hammasi o'sha listga (faza = label),
    // aks holda CSV "List" ustuni bo'yicha (Phase 0..4). Yo'q bo'lsa yaratamiz.
    const listName = process.env.TRELLO_TARGET_LIST || r['List'];
    let idList = listByName.get(listName);
    if (!idList) {
      const l = await api('POST', `/lists?name=${encodeURIComponent(listName)}&idBoard=${BOARD_ID}`);
      idList = l.id; listByName.set(listName, idList);
      console.log(`＋ list yaratildi: ${listName}`);
    }

    // label'lar — yo'qini yaratamiz (yarim nuqta bilan ajratilgan)
    const idLabels = [];
    for (const ln of (r['Labels'] || '').split(';').map((s) => s.trim()).filter(Boolean)) {
      let id = labelByName.get(ln);
      if (!id) {
        const lab = await api('POST', `/labels?name=${encodeURIComponent(ln)}&color=${labelColor(ln)}&idBoard=${BOARD_ID}`);
        id = lab.id; labelByName.set(ln, id);
      }
      idLabels.push(id);
    }

    const body = { idList, name, desc: r['Description'] || '', idLabels };
    if (r['Due Date']) body.due = r['Due Date'];

    await api('POST', '/cards', body);
    cardNames.add(name);
    created++;
    console.log(`✔ ${name}`);
  }

  console.log(`\n✅ Tugadi. Yaratildi: ${created}, o'tkazib yuborildi: ${skipped}.`);
  console.log(`ℹ️  Members (Lead/Dilshodbek/Bahodir) biriktirilmadi — ular real Trello username emas.`);
  console.log(`   Cardlarni ochib qo'lda a'zo qo'shing, yoki CSV'dagi nomlarni real @username qiling.`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });

// ============================================================================
// Trello board holatini o'qiydi (audit): qaysi karta qaysi listda,
// checklist punktlari nechtasi ✓ bo'lgan. Faqat O'QIYDI (hech nima yozmaydi).
//   node docs/trello-audit.mjs
// Creds .env.trello dan (trello-sync bilan bir xil).
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const BOARD_ID = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';

function loadCreds() {
  let key = process.env.TRELLO_KEY, token = process.env.TRELLO_TOKEN;
  for (const f of [join(ROOT, '.env.trello'), join(HERE, '.env.trello')]) {
    if ((key && token) || !existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      if (m[1] === 'TRELLO_KEY') key ||= m[2]; else token ||= m[2];
    }
  }
  return { key, token };
}
const { key, token } = loadCreds();
const auth = `key=${key}&token=${token}`;
async function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.trello.com/1${path}${sep}${auth}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const lists = await api(`/boards/${BOARD_ID}/lists?fields=name`);
const listName = new Map(lists.map((l) => [l.id, l.name]));
const cards = await api(`/boards/${BOARD_ID}/cards?fields=name,idList,idMembers&checklists=all`);
const members = await api(`/boards/${BOARD_ID}/members?fields=username`);
const memberName = new Map(members.map((m) => [m.id, m.username]));

// Guruhlash: list -> cardlar
const byList = new Map(lists.map((l) => [l.name, []]));
for (const c of cards) {
  const ln = listName.get(c.idList) || '(list yo\'q)';
  let total = 0, done = 0;
  for (const cl of c.checklists || []) for (const ci of cl.checkItems || []) {
    total++; if (ci.state === 'complete') done++;
  }
  const who = (c.idMembers || []).map((id) => memberName.get(id) || id).join(',') || '-';
  (byList.get(ln) || (byList.set(ln, []), byList.get(ln))).push({ name: c.name, done, total, who });
}

console.log(`\n📋 BOARD AUDIT — ${cards.length} card, ${lists.length} list\n`);
for (const l of lists) {
  const arr = byList.get(l.name) || [];
  console.log(`\n━━━ ${l.name.toUpperCase()} (${arr.length}) ━━━`);
  arr.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  for (const c of arr) {
    const chk = c.total ? `${c.done}/${c.total}${c.done === c.total ? ' ✅' : ''}` : '—';
    console.log(`  [${chk.padEnd(8)}] ${c.name}   ·${c.who}`);
  }
}
// Xulosa: list bo'yicha sanoq
console.log('\n\n=== LIST BO\'YICHA SANOQ ===');
for (const l of lists) console.log(`  ${l.name}: ${(byList.get(l.name) || []).length}`);

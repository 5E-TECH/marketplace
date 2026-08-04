// ============================================================================
// CHUQUR AUDIT (read-only). Har karta uchun: list, a'zolar, checklist ✓,
// yaratilgan sana (id'dan), deadline (due), dueComplete, va list harakatlari
// tarixi (qachon qaysi listga ko'chgan) -> lead-time va deadline holati.
//   node docs/trello-deep-audit.mjs
// Creds .env.trello dan. Hech nima YOZMAYDI.
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
const D = (s) => (s ? new Date(s) : null);
const fmt = (d) => (d ? d.toISOString().slice(0, 10) : '—');
const days = (a, b) => (a && b ? Math.round((b - a) / 86400000) : null);
// Trello card id'ning birinchi 8 hex = yaratilgan unix vaqti
const createdOf = (id) => new Date(parseInt(id.substring(0, 8), 16) * 1000);

const lists = await api(`/boards/${BOARD_ID}/lists?fields=name`);
const listName = new Map(lists.map((l) => [l.id, l.name]));
const cards = await api(
  `/boards/${BOARD_ID}/cards?fields=name,idList,idMembers,due,dueComplete,start,dateLastActivity&checklists=all`,
);
const members = await api(`/boards/${BOARD_ID}/members?fields=username`);
const memberName = new Map(members.map((m) => [m.id, m.username]));

const DONE = lists.find((l) => /done/i.test(l.name))?.name;

// Har karta uchun list-harakat tarixini olamiz (qachon Done'ga tushdi)
async function movedInto(cardId, targetListName) {
  const acts = await api(
    `/cards/${cardId}/actions?filter=updateCard&fields=date,data&limit=50`,
  );
  for (const a of acts) {
    if (a.data?.listAfter?.name === targetListName) return D(a.date);
  }
  return null;
}

const rows = [];
for (const c of cards) {
  let total = 0, done = 0;
  for (const cl of c.checklists || []) for (const ci of cl.checkItems || []) {
    total++; if (ci.state === 'complete') done++;
  }
  const ln = listName.get(c.idList) || '(list yo\'q)';
  const created = createdOf(c.id);
  const due = D(c.due);
  const isDone = DONE && ln === DONE;
  const doneAt = isDone ? await movedInto(c.id, DONE) : null;
  rows.push({
    name: c.name, list: ln, isDone,
    who: (c.idMembers || []).map((id) => memberName.get(id) || id).join(',') || '-',
    done, total, created, due, dueComplete: c.dueComplete, doneAt,
    lastAct: D(c.dateLastActivity),
  });
}
rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

console.log(`\n📋 CHUQUR AUDIT — ${cards.length} card · Done list: "${DONE}"\n`);

// 1) DONE kartalar: deadline holati + lead-time
console.log('━━━━━━━━ DONE KARTALAR: DEADLINE & LEAD-TIME ━━━━━━━━');
console.log('karta                         | chk    | yaratildi  | deadline   | done bo\'ldi | lead(kun) | deadline holati');
console.log('------------------------------|--------|------------|------------|------------|-----------|----------------');
const doneRows = rows.filter((r) => r.isDone);
for (const r of doneRows) {
  const chk = r.total ? `${r.done}/${r.total}` : '—';
  const lead = days(r.created, r.doneAt);
  let dl = '—';
  if (r.due) {
    if (r.doneAt) dl = r.doneAt <= r.due ? `✅ +${days(r.doneAt, r.due)}k oldin` : `⚠️ ${days(r.due, r.doneAt)}k kech`;
    else dl = r.dueComplete ? '✅ (due✓)' : '?';
  }
  console.log(
    `${r.name.slice(0, 29).padEnd(29)} | ${chk.padEnd(6)} | ${fmt(r.created)} | ${fmt(r.due).padEnd(10)} | ${fmt(r.doneAt).padEnd(10)} | ${String(lead ?? '—').padStart(9)} | ${dl}`,
  );
}

// 2) OCHIQ (Done emas) kartalar: deadline yaqinmi?
console.log('\n━━━━━━━━ OCHIQ KARTALAR (Done emas): DEADLINE ━━━━━━━━');
console.log('karta                         | list       | chk    | deadline   | a\'zo');
console.log('------------------------------|------------|--------|------------|------');
for (const r of rows.filter((x) => !x.isDone)) {
  const chk = r.total ? `${r.done}/${r.total}` : '—';
  console.log(
    `${r.name.slice(0, 29).padEnd(29)} | ${r.list.slice(0, 10).padEnd(10)} | ${chk.padEnd(6)} | ${fmt(r.due).padEnd(10)} | ${r.who}`,
  );
}

// 3) Umumiy statistika
console.log('\n━━━━━━━━ STATISTIKA ━━━━━━━━');
const withDue = rows.filter((r) => r.due);
const doneWithDue = doneRows.filter((r) => r.due && r.doneAt);
const onTime = doneWithDue.filter((r) => r.doneAt <= r.due).length;
const leadArr = doneRows.map((r) => days(r.created, r.doneAt)).filter((x) => x != null);
const avgLead = leadArr.length ? (leadArr.reduce((a, b) => a + b, 0) / leadArr.length).toFixed(1) : '—';
console.log(`  Jami karta: ${rows.length}`);
console.log(`  Done: ${doneRows.length} · Ochiq: ${rows.length - doneRows.length}`);
console.log(`  Deadline (due) qo'yilgan: ${withDue.length} / ${rows.length}`);
console.log(`  Done + deadline bor: ${doneWithDue.length}, shundan o'z vaqtida: ${onTime}`);
console.log(`  O'rtacha lead-time (yaratildi→done): ${avgLead} kun`);
for (const l of lists) {
  const n = rows.filter((r) => r.list === l.name).length;
  console.log(`  · ${l.name}: ${n}`);
}

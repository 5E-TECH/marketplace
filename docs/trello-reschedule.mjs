// ============================================================================
// Deadline qayta rejalash (C-kartalar):
//  - Done listdagi kartalar  → due = haqiqiy tugatilgan sana (Done'ga ko'chgan)
//  - Mening Testing kartalarim (shodiyorergashev) → due = tugatilgan sana (map)
//  - Ochiq kartalar → proporsional siqiladi, oxirgisi TARGET_END (2026-09-30)
//    muddati o'tganlari → today+3 (tez bajarish)
// Ishga tushirish: node docs/trello-reschedule.mjs [--apply]
// --apply bo'lmasa faqat preview (hech nima o'zgartirmaydi).
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const BOARD_ID = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';

function loadCreds() {
  let key = process.env.TRELLO_KEY, token = process.env.TRELLO_TOKEN;
  for (const f of [join(ROOT, '.env.trello'), join(HERE, '.env.trello')]) {
    if ((key && token) || !existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      if (m[1] === 'TRELLO_KEY') key ||= m[2]; else token ||= m[2];
    }
  }
  return { key, token };
}
const { key, token } = loadCreds();
const auth = `key=${key}&token=${token}`;
async function api(path, method = 'GET') {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.trello.com/1${path}${sep}${auth}`, { method });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const DAY = 86400000;
const today = new Date('2026-08-07T12:00:00Z');
const TARGET_END = new Date('2026-09-30T12:00:00Z');
const OLD_MAX = new Date('2026-10-12T12:00:00Z');
const factor = (TARGET_END - today) / (OLD_MAX - today); // ~0.818
const iso = (d) => d.toISOString();
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : '—');
const addDays = (base, n) => new Date(base.getTime() + n * DAY);

// Mening Testing kartalarim tugatilgan sanasi (haqiqiy)
const MY_DONE = {
  'C1.1': '2026-08-04', 'C1.2': '2026-08-04', 'C1.3': '2026-08-05',
  'C1.4': '2026-08-05', 'C1.5': '2026-08-05', 'C1.6': '2026-08-05',
  'C1.7': '2026-08-05', 'C2.1': '2026-08-07',
};

const lists = await api(`/boards/${BOARD_ID}/lists?fields=name`);
const listName = new Map(lists.map((l) => [l.id, l.name]));
const DONE = lists.find((l) => /done/i.test(l.name))?.name;
const TESTING = lists.find((l) => /testing/i.test(l.name))?.name;
const members = await api(`/boards/${BOARD_ID}/members?fields=username`);
const meId = members.find((m) => m.username === 'shodiyorergashev')?.id;
const cards = await api(
  `/boards/${BOARD_ID}/cards?fields=name,idList,idMembers,due`,
);

async function doneAt(cardId) {
  const acts = await api(
    `/cards/${cardId}/actions?filter=updateCard&fields=date,data&limit=50`,
  );
  for (const a of acts) if (a.data?.listAfter?.name === DONE) return new Date(a.date);
  return null;
}

const rows = [];
for (const c of cards) {
  const code = (c.name.match(/^(C\d+\.\d+)/) || [])[1];
  if (!code || !c.due) continue;
  const ln = listName.get(c.idList);
  const oldDue = new Date(c.due);
  const mine = (c.idMembers || []).includes(meId);
  let newDue, kind;

  if (ln === DONE) {
    newDue = (await doneAt(c.id)) ?? oldDue;
    kind = 'done→haqiqiy';
  } else if (ln === TESTING && mine && MY_DONE[code]) {
    newDue = new Date(`${MY_DONE[code]}T12:00:00Z`);
    kind = 'test(mine)→tugatilgan';
  } else {
    const daysOut = Math.round((oldDue - today) / DAY);
    const newDays = daysOut <= 0 ? 3 : Math.round(daysOut * factor);
    newDue = addDays(today, newDays);
    kind = 'ochiq→siqildi';
  }
  rows.push({ id: c.id, code, name: c.name, ln, oldDue, newDue, kind });
}

rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
console.log(`\n📅 RESCHEDULE ${APPLY ? '(APPLY)' : '(PREVIEW — --apply bilan qo\'llang)'} — ${rows.length} karta\n`);
console.log('karta                          | list     | eski       | yangi      | tur');
console.log('-------------------------------|----------|------------|------------|-----');
for (const r of rows) {
  console.log(
    `${r.name.slice(0, 30).padEnd(30)} | ${(r.ln || '').slice(0, 8).padEnd(8)} | ${ymd(r.oldDue)} | ${ymd(r.newDue)} | ${r.kind}`,
  );
  if (APPLY) await api(`/cards/${r.id}?due=${encodeURIComponent(iso(r.newDue))}`, 'PUT');
}
console.log(`\nOxirgi (eng kech yangi) muddat: ${ymd(rows.reduce((m, r) => (r.newDue > m ? r.newDue : m), today))}`);
console.log(APPLY ? '✅ Qo\'llandi.' : 'ℹ️  Preview. Qo\'llash: node docs/trello-reschedule.mjs --apply');

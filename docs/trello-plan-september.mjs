// ============================================================================
// Board auditi va sentabr jadvali:
//   1) qisqa tavsifli cardlarni to'liq matn bilan almashtiradi,
//   2) barcha ochiq cardga bog'liqlik tartibidagi muddat qo'yadi (sentabr oxiri).
// Idempotent — qayta ishlatish xavfsiz.
//   node docs/trello-plan-september.mjs
// ============================================================================
import { readFileSync } from 'node:fs';
import descs from './card-descriptions-v2.mjs';
import schedule from '/tmp/schedule.mjs';

const B = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
let key = process.env.TRELLO_KEY, token = process.env.TRELLO_TOKEN;
if (!key || !token) for (const l of readFileSync('.env.trello','utf8').split('\n')) {
  const m = l.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
  if (m?.[1]==='TRELLO_KEY') key ||= m[2]; else if (m) token ||= m[2];
}
const auth = `key=${key}&token=${token}`;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const api = async (method, path) => {
  const r = await fetch(`https://api.trello.com/1${path}${path.includes('?')?'&':'?'}${auth}`, { method });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}`);
  await sleep(120); return r.status===204?null:r.json();
};

const lists = await api('GET', `/boards/${B}/lists?fields=name`);
const doneId = lists.find(l=>l.name.startsWith('Done')).id;
const cards = await api('GET', `/boards/${B}/cards?fields=name,idList,desc,due`);
const open = cards.filter(c=>c.idList!==doneId && !['Backlog','Doing','Testing','[Example task]'].includes(c.name));

let descUpdated=0, dueUpdated=0, missing=[];
for (const c of open) {
  const code = c.name.split(' ')[0];
  const q = new URLSearchParams();
  if (descs[code] && c.desc !== descs[code]) { q.set('desc', descs[code]); descUpdated++; }
  if (schedule[code]) {
    const due = `2026-${schedule[code]}T12:00:00.000Z`;
    if (c.due !== due) { q.set('due', due); dueUpdated++; }
  } else missing.push(code);
  if ([...q].length) await api('PUT', `/cards/${c.id}?${q}`);
}
console.log(`Tavsif yangilandi: ${descUpdated}`);
console.log(`Muddat yangilandi: ${dueUpdated}`);
if (missing.length) console.log(`Jadvalda yo'q: ${missing.join(', ')}`);

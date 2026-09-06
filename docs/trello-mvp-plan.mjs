// ============================================================================
// Yakuniy reja: MVP 15-sentabr, qolgani sentabr oxirigacha.
//   1) backend auditida topilgan C6.x cardlarini yaratadi (Dilshodbek),
//   2) barcha ochiq cardga bog'liqlik tartibidagi muddat qo'yadi,
//   3) "MVP 15-sen" yorlig'ini MVP uchun majburiy cardlarga qo'yadi.
// Idempotent.
// ============================================================================
import { readFileSync } from 'node:fs';
import gaps from './backend-gap-cards.mjs';
import { mvp, after, qa } from '/tmp/final-plan.mjs';

const B = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
let key = process.env.TRELLO_KEY, token = process.env.TRELLO_TOKEN;
if (!key || !token) for (const l of readFileSync('.env.trello','utf8').split('\n')) {
  const m = l.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
  if (m?.[1]==='TRELLO_KEY') key ||= m[2]; else if (m) token ||= m[2];
}
const auth=`key=${key}&token=${token}`, sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const api = async (method, path) => {
  const r = await fetch(`https://api.trello.com/1${path}${path.includes('?')?'&':'?'}${auth}`, { method });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  await sleep(120); return r.status===204?null:r.json();
};
const MEMBER = { Lead:'shodiyorergashev', Dilshodbek:'urozov04', Bahodir:'nabijanov' };
const CHECKLIST = "🧪 Test (Done'dan oldin)";

const [lists, labels, members] = await Promise.all([
  api('GET', `/boards/${B}/lists?fields=name`),
  api('GET', `/boards/${B}/labels`),
  api('GET', `/boards/${B}/members?fields=username`),
]);
const backlog = lists.find(l=>l.name==='Backlog').id;
const doneId = lists.find(l=>l.name.startsWith('Done')).id;
const labelId = new Map(labels.filter(l=>l.name).map(l=>[l.name,l.id]));
const memberId = new Map(members.map(m=>[m.username,m.id]));
const mvpLabel = labelId.get('MVP 15-sen');

// ── 1. Backend bo'shliq cardlari ───────────────────────────────────────────
let cards = await api('GET', `/boards/${B}/cards?fields=name,idList,idLabels,due`);
let created=0;
for (const g of gaps) {
  if (cards.find(c=>c.name.startsWith(g.code+' '))) continue;
  const q = new URLSearchParams({ name:g.name, desc:g.desc, idList:backlog,
    due:`${g.due}T12:00:00.000Z` });
  const ids = g.labels.split(';').map(n=>labelId.get(n.trim())).filter(Boolean).join(',');
  if (ids) q.set('idLabels', ids);
  const mid = memberId.get(MEMBER[g.member]); if (mid) q.set('idMembers', mid);
  const made = await api('POST', `/cards?${q}`);
  const cl = await api('POST', `/checklists?idCard=${made.id}&name=${encodeURIComponent(CHECKLIST)}`);
  for (const t of g.tests) await api('POST', `/checklists/${cl.id}/checkItems?name=${encodeURIComponent(t)}`);
  created++;
  console.log(`  + ${g.code} → Dilshodbek`);
}

// ── 2. Muddatlar va MVP yorlig'i ───────────────────────────────────────────
cards = await api('GET', `/boards/${B}/cards?fields=name,idList,idLabels,due`);
const open = cards.filter(c=>c.idList!==doneId && !['Backlog','Doing','Testing','[Example task]'].includes(c.name));
const all = { ...qa, ...after, ...mvp };
let dued=0, labeled=0, unlabeled=0, unknown=[];
for (const c of open) {
  const code = c.name.split(' ')[0];
  if (!all[code]) { unknown.push(code); continue; }
  const due = `2026-${all[code]}T12:00:00.000Z`;
  if (c.due !== due) { await api('PUT', `/cards/${c.id}?due=${due}`); dued++; }
  const shouldHave = code in mvp;
  const has = c.idLabels.includes(mvpLabel);
  if (shouldHave && !has) { await api('POST', `/cards/${c.id}/idLabels?value=${mvpLabel}`); labeled++; }
  if (!shouldHave && has) { await api('DELETE', `/cards/${c.id}/idLabels/${mvpLabel}`); unlabeled++; }
}
console.log(`\nYaratildi: ${created} | muddat: ${dued} | MVP yorlig'i +${labeled}/-${unlabeled}`);
if (unknown.length) console.log(`Jadvalsiz: ${unknown.join(', ')}`);

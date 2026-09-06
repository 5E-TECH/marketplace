// ============================================================================
// Storefront (xaridor sayti) cardlarini Trello'ga yozadi.
// Mavjud card bo'lsa — nomi, tavsifi, muddati va test checklisti yangilanadi.
// Bo'lmasa — Backlog'da yangisi yaratiladi.
// Idempotent: qayta ishlatilsa dublikat yaratmaydi.
//
//   node docs/trello-storefront.mjs
// ============================================================================
import { readFileSync } from 'node:fs';
import cards from './storefront-cards.mjs';

const BOARD_ID = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
const CHECKLIST = "🧪 Test (Done'dan oldin)";
const MEMBER_MAP = { Lead: 'shodiyorergashev', Dilshodbek: 'urozov04', Bahodir: 'nabijanov' };

function creds() {
  let key = process.env.TRELLO_KEY, token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    for (const line of readFileSync('.env.trello', 'utf8').split('\n')) {
      const m = line.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
      if (m?.[1] === 'TRELLO_KEY') key ||= m[2];
      else if (m) token ||= m[2];
    }
  }
  return { key, token };
}
const { key, token } = creds();
const auth = `key=${key}&token=${token}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.trello.com/1${path}${sep}${auth}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  await sleep(120);
  return res.status === 204 ? null : res.json();
}

const [lists, labels, members, existing] = await Promise.all([
  api('GET', `/boards/${BOARD_ID}/lists?fields=name`),
  api('GET', `/boards/${BOARD_ID}/labels`),
  api('GET', `/boards/${BOARD_ID}/members?fields=username`),
  api('GET', `/boards/${BOARD_ID}/cards?fields=name,idList`),
]);
const backlog = lists.find((l) => l.name === 'Backlog').id;
const labelId = new Map(labels.filter((l) => l.name).map((l) => [l.name, l.id]));
const memberId = new Map(members.map((m) => [m.username, m.id]));

let created = 0, updated = 0;
for (const c of cards) {
  const found = existing.find((x) => x.name.startsWith(c.code + ' '));
  const idLabels = c.labels.split(';').map((n) => labelId.get(n.trim())).filter(Boolean).join(',');
  const idMembers = memberId.get(MEMBER_MAP[c.member]) || '';
  const q = new URLSearchParams({ name: c.name, desc: c.desc, due: c.due + 'T12:00:00.000Z' });

  let cardId;
  if (found) {
    await api('PUT', `/cards/${found.id}?${q}`);
    cardId = found.id;
    updated++;
    console.log(`  ✎ yangilandi: ${c.code}`);
  } else {
    q.set('idList', backlog);
    if (idLabels) q.set('idLabels', idLabels);
    if (idMembers) q.set('idMembers', idMembers);
    const made = await api('POST', `/cards?${q}`);
    cardId = made.id;
    created++;
    console.log(`  + yaratildi:  ${c.code}`);
  }

  // Test checklisti — eskisi o'chirilib, yangisi qo'yiladi (tavsif bilan mos bo'lsin).
  const cls = await api('GET', `/cards/${cardId}/checklists?fields=name`);
  for (const cl of cls.filter((x) => x.name === CHECKLIST)) {
    await api('DELETE', `/checklists/${cl.id}`);
  }
  const cl = await api('POST', `/checklists?idCard=${cardId}&name=${encodeURIComponent(CHECKLIST)}`);
  for (const t of c.tests) {
    await api('POST', `/checklists/${cl.id}/checkItems?name=${encodeURIComponent(t)}`);
  }
}

console.log(`\n✅ Yaratildi: ${created}, yangilandi: ${updated}, jami: ${cards.length}`);

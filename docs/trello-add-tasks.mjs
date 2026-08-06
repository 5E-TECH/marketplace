// ============================================================================
// TZ ochiq savollari (§16) + production gap'lari uchun yangi kartalar qo'shadi.
// Idempotent: shu nomli karta bo'lsa qayta yaratmaydi.
//   node docs/trello-add-tasks.mjs [--apply]
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
async function api(path, method = 'GET', body) {
  const sep = path.includes('?') ? '&' : '?';
  const opts = { method };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const res = await fetch(`https://api.trello.com/1${path}${sep}${auth}`, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const lists = await api(`/boards/${BOARD_ID}/lists?fields=name`);
const backlog = lists.find((l) => /backlog/i.test(l.name));
const members = await api(`/boards/${BOARD_ID}/members?fields=username`);
const memberId = (u) => members.find((m) => m.username === u)?.id;
const existing = await api(`/boards/${BOARD_ID}/cards?fields=name`);
const has = (name) => existing.some((c) => c.name.startsWith(name.split(' —')[0].split(':')[0]));

const TASKS = [
  {
    name: 'C2.19 Buyer guest checkout (telefon lightweight)',
    who: 'urozov04',
    due: '2026-09-06',
    desc: '**Maqsad:** Xaridor ro‘yxatdan o‘tmasdan (guest) telefon bo‘yicha checkout qilishi. Lightweight buyer (identity.customer.create — phone bo‘yicha idempotent) + ixtiyoriy login. Manba: MARKETPLACE_PLAN §16 (ochiq savol #2).',
    tc: ['TC1 telefon bilan guest->buyer yaratiladi', 'TC2 bir xil telefon->mavjud buyer', 'TC3 checkout buyer_id bilan sales_order'],
  },
  {
    name: 'C2.20 Dostavka narxi (checkout + storefront preview)',
    who: 'urozov04',
    due: '2026-09-08',
    desc: '**Maqsad:** Yetkazish narxini (Elchi tariff, per-package) checkout jamida hisoblash + storefront preview. Ko‘p-sotuvchili savatda har posilkaga alohida. Manba: §16 (ochiq savol #3), §9.',
    tc: ['TC1 checkout->har posilka dostavka narxi', 'TC2 jami = subtotal+dostavka', 'TC3 storefront preview ko‘rsatadi'],
  },
  {
    name: 'C4.7 Production tayyorligi (seed/health/backup/rate-limit)',
    who: 'shodiyorergashev',
    due: '2026-09-28',
    desc: '**Maqsad:** Deploydan oldin production tayyorligi. Har servis /health + readiness, seed (superadmin/kategoriya), DB backup rejasi, rate-limit prod qiymatlari, .env.production audit. C4.6 (deploy) dan oldin.',
    tc: ['TC1 har servis /health 200', 'TC2 seed script ishlaydi', 'TC3 DB backup skript', 'TC4 rate-limit prod qiymatlari'],
  },
];

console.log(`\n➕ YANGI TASKLAR ${APPLY ? '(APPLY)' : '(PREVIEW)'}\n`);
for (const t of TASKS) {
  if (has(t.name)) { console.log(`  ⏭️  mavjud: ${t.name}`); continue; }
  console.log(`  ${APPLY ? '✅' : '•'} ${t.name}  [${t.who}, due ${t.due}]`);
  if (!APPLY) continue;
  const card = await api(`/cards`, 'POST', {
    idList: backlog.id,
    name: t.name,
    desc: t.desc,
    due: `${t.due}T12:00:00Z`,
    idMembers: [memberId(t.who)].filter(Boolean),
  });
  const cl = await api(`/cards/${card.id}/checklists`, 'POST', { name: '🧪 Test (Done\'dan oldin)' });
  for (const item of t.tc) await api(`/checklists/${cl.id}/checkItems`, 'POST', { name: item });
}
console.log(APPLY ? '\n✅ Qo\'shildi.' : '\nℹ️  Preview. Qo\'llash: --apply');

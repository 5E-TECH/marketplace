// ============================================================================
// Kod tayyor (merged + test yashil) kartalarni Trello'da Done'ga keltiradi:
//  - kartani "Done 🎉" listiga ko'chiradi (agar boshqa listda bo'lsa)
//  - barcha checklist punktlarini ✓ (complete) qiladi (DoD)
// Faqat pastdagi TARGETS ro'yxatidagi kartalarga tegadi. Idempotent.
//   node docs/trello-mark-done.mjs
// Creds .env.trello dan.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const BOARD_ID = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
const DONE_LIST = 'Done 🎉';

// Kod tayyor (merged dev+main, test yashil) — Done'ga keltiriladigan kartalar.
// Nom prefiksi bilan mos keladi (masalan "C0.5" -> "C0.5 CI/CD ...").
const TARGETS = ['C0.4', 'C0.5'];

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.trello.com/1${path}${sep}${auth}`, { method });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  await sleep(120);
  return res.json();
}

const lists = await api('GET', `/boards/${BOARD_ID}/lists?fields=name`);
const doneList = lists.find((l) => l.name === DONE_LIST);
if (!doneList) throw new Error(`"${DONE_LIST}" list topilmadi`);
const listName = new Map(lists.map((l) => [l.id, l.name]));

const cards = await api('GET', `/boards/${BOARD_ID}/cards?fields=name,idList&checklists=all`);

for (const prefix of TARGETS) {
  const card = cards.find((c) => c.name.startsWith(prefix + ' ') || c.name === prefix);
  if (!card) { console.log(`? topilmadi: ${prefix}`); continue; }
  console.log(`\n▶ ${card.name}  (hozir: ${listName.get(card.idList)})`);

  // 1) Done listiga ko'chir
  if (card.idList !== doneList.id) {
    await api('PUT', `/cards/${card.id}?idList=${doneList.id}`);
    console.log(`  ✔ "${DONE_LIST}" listiga ko'chirildi`);
  } else {
    console.log(`  · allaqachon Done'da`);
  }

  // 2) Checklist punktlarini ✓ qil
  let done = 0, already = 0;
  for (const cl of card.checklists || []) {
    for (const ci of cl.checkItems || []) {
      if (ci.state === 'complete') { already++; continue; }
      await api('PUT', `/cards/${card.id}/checkItem/${ci.id}?state=complete`);
      done++;
    }
  }
  console.log(`  ✔ checklist: ${done} yangi ✓, ${already} avval ✓`);
}
console.log('\n✅ Tugadi.');

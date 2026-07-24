// ============================================================================
// Trello sync — HAMMASI BITTA BUYRUQDA (token bir marta saqlanadi).
//
// Kalit/token'ni repo ildizidagi `.env.trello` faylidan (yoki env'dan) o'qiydi,
// so'ng ketma-ket ishga tushiradi: import -> assign-members -> checklists.
// `.env.trello` .gitignore bilan git'ga TUSHMAYDI (maxfiy).
//
// ISHLATISH (token bir marta .env.trello ga qo'yilgach):
//   node docs/trello-sync.mjs docs/trello-admin-mvp.csv
//   node docs/trello-sync.mjs                     # default: docs/trello-import.csv
//
// Token olish (bir marta): .env.trello ichidagi havolani brauzerda oching -> Allow.
// BOARD_ID va TARGET_LIST default berilgan (Elchi Marketplace board / Backlog).
// Idempotent: mavjud card/checklist/a'zo qayta yaratilmaydi.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url)); // docs/
const ROOT = dirname(HERE); // repo ildizi
const CSV = process.argv[2] || join(HERE, 'trello-import.csv');
const BOARD_ID = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
const TARGET_LIST = process.env.TRELLO_TARGET_LIST || 'Backlog';

// ── creds: env yoki .env.trello (repo ildizida yoki docs/da) ────────────────
function loadCreds() {
  let key = process.env.TRELLO_KEY;
  let token = process.env.TRELLO_TOKEN;
  for (const f of [join(ROOT, '.env.trello'), join(HERE, '.env.trello')]) {
    if ((key && token) || !existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      if (m[1] === 'TRELLO_KEY') key ||= m[2];
      else token ||= m[2];
    }
  }
  return { key, token };
}

const { key, token } = loadCreds();
if (!key || !token) {
  console.error('❌ TRELLO_KEY/TRELLO_TOKEN topilmadi.');
  console.error('   `.env.trello` faylini yarating va TRELLO_TOKEN= ga token qo\'ying.');
  console.error('   Token olish: https://trello.com/1/authorize?key=' + (key || '<KEY>') +
    '&name=Elchi%20Marketplace&expiration=never&response_type=token&scope=read,write');
  process.exit(1);
}

const base = { TRELLO_KEY: key, TRELLO_TOKEN: token, TRELLO_BOARD_ID: BOARD_ID };
const steps = [
  ['trello-import.mjs', { ...base, TRELLO_TARGET_LIST: TARGET_LIST }],
  ['trello-assign-members.mjs', base],
  ['trello-add-checklists.mjs', base],
];

console.log(`📋 Board: ${BOARD_ID} · List: ${TARGET_LIST} · CSV: ${CSV}\n`);
for (const [script, env] of steps) {
  console.log(`▶ ${script}`);
  const r = spawnSync(process.execPath, [join(HERE, script), CSV], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    console.error(`❌ ${script} xato bilan tugadi (kod ${r.status}).`);
    process.exit(r.status || 1);
  }
  console.log('');
}
console.log('✅ Trello sync tugadi — cardlar + a\'zolar + test checklistlar joyida.');

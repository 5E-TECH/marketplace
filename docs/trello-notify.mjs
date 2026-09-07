// Doing'ga qaytarilgan cardlar bo'yicha har dasturchiga bildirishnoma yuboradi.
// Trello @username eslatilganda o'sha odamga xabar beradi.
import { readFileSync } from 'node:fs';
const B = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
let key=process.env.TRELLO_KEY, token=process.env.TRELLO_TOKEN;
if(!key||!token) for(const l of readFileSync('.env.trello','utf8').split('\n')){
  const m=l.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
  if(m?.[1]==='TRELLO_KEY') key||=m[2]; else if(m) token||=m[2];
}
const auth=`key=${key}&token=${token}`, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(m,p)=>{const r=await fetch(`https://api.trello.com/1${p}${p.includes('?')?'&':'?'}${auth}`,{method:m});
  if(!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${await r.text()}`); await sleep(130); return r.status===204?null:r.json();};

// Qaysi TC qolgan (audit natijasidan)
const LEFT = {
  'C2.20':'TC1, TC2, TC3 — dostavka narxi uchun birorta test yo\'q',
  'C3.2' :'hammasi — Payme sandbox hisobi kerak (C7.1)',
  'C3.3' :'hammasi — Click sandbox hisobi kerak (C7.1)',
  'C4.7' :'seed qismi — rate-limit, health va backup tekshirilgan',
  'C1.20':'TC3 — majburiy maydon bo\'sh qolganda validatsiya',
  'C1.33':'TC3, TC4 — TC3 C6.1 (jamoa boshqaruvi) tugamaguncha bajarilmaydi',
  'C1.34':'hammasi — bu sahifaga birorta e2e test yo\'q',
  'C1.35':'TC2 — rol va holat filtri',
  'C1.36':'TC4 — buyurtmasiz bo\'sh holat',
  'C1.37':'TC1, TC4 — kategoriya daraxti va dublikat slug xatosi',
  'C1.39':'TC1, TC3 — operator qo\'shish va buyurtmani tasdiqlashi',
  'C4.5' :'TC3 — audit jurnaliga yozilishi',
  'C1.1' :'TC1, TC3 — migratsiya sxemasi va AES shifrlash',
  'C4.6' :'TC1, TC3 — to\'liq E2E oqim va servis yiqilganda alert',
};

const lists = await api('GET',`/boards/${B}/lists?fields=name`);
const doing = lists.find(l=>l.name==='Doing').id;
const members = await api('GET',`/boards/${B}/members?fields=username,fullName`);
const uname = Object.fromEntries(members.map(m=>[m.id,m.username]));
const cards = (await api('GET',`/lists/${doing}/cards?fields=name,due,idMembers`))
  .sort((a,b)=>(a.due||'').localeCompare(b.due||''));

// Dasturchi bo'yicha guruhlash (muddat tartibida)
const byUser = {};
for (const c of cards) {
  const u = uname[c.idMembers[0]];
  if (!u) continue;
  (byUser[u] ||= []).push(c);
}

let notified = 0;
for (const [user, list] of Object.entries(byUser)) {
  // 1) Umumiy xulosa — eng erta muddatli cardga
  const summary = [
    `@${user} — Testing tekshiruvidan keyin sizga ${list.length} ta card qaytarildi.`,
    ``,
    `Muddat bo'yicha tartib:`,
    ...list.map((c,i)=>{
      const code = c.name.split(' ')[0];
      return `${i+1}. ${c.due.slice(5,10)} — ${code}: ${LEFT[code] || '(tafsilot cardda)'}`;
    }),
    ``,
    `Yuqoridan pastga qarab bajaring — ro'yxat muddat bo'yicha tartiblangan.`,
    `Har cardning ichida nima qolgani va nega qaytarilgani batafsil yozilgan.`,
    `Card Done'ga faqat test checklisti to'liq ✓ bo'lgandan keyin o'tadi.`,
  ].join('\n');
  await api('POST',`/cards/${list[0].id}/actions/comments?text=${encodeURIComponent(summary)}`);
  console.log(`  ✉ ${user}: umumiy ro'yxat (${list.length} ta) → ${list[0].name.split(' ')[0]}`);

  // 2) Har cardga alohida eslatma — har biri uchun alohida bildirishnoma
  for (const [i,c] of list.entries()) {
    const code = c.name.split(' ')[0];
    const txt = `@${user} — bu card Testing dan qaytarildi.\n\n`
      + `Muddat: ${c.due.slice(0,10)}\n`
      + `Sizdagi navbat: ${i+1}/${list.length}\n`
      + `Qolgan ish: ${LEFT[code] || '(yuqoridagi izohga qarang)'}\n\n`
      + `Testlarni qo'lda bajarib, checklistni to'ldiring. Hammasi ✓ bo'lgach Done ga o'tkazing.`;
    await api('POST',`/cards/${c.id}/actions/comments?text=${encodeURIComponent(txt)}`);
    notified++;
  }
}
console.log(`\nBildirishnoma yuborildi: ${notified} ta card, ${Object.keys(byUser).length} ta dasturchi`);

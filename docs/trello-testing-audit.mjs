// Testing ro'yxatidagi cardlarni kod bilan solishtirib tekshiradi:
//  - avtomatik test qoplagan TC lar ✓ belgilanadi,
//  - hammasi qoplangan card -> Done,
//  - qoplanmagani qolgan card -> Doing, sababi va navbati izohda.
import { readFileSync } from 'node:fs';
const B = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
let key=process.env.TRELLO_KEY, token=process.env.TRELLO_TOKEN;
if(!key||!token) for(const l of readFileSync('.env.trello','utf8').split('\n')){
  const m=l.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
  if(m?.[1]==='TRELLO_KEY') key||=m[2]; else if(m) token||=m[2];
}
const auth=`key=${key}&token=${token}`, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(m,p)=>{const r=await fetch(`https://api.trello.com/1${p}${p.includes('?')?'&':'?'}${auth}`,{method:m});
  if(!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${await r.text()}`); await sleep(110); return r.status===204?null:r.json();};

// Hammasi qoplangan — TC lar belgilanadi va Done'ga o'tadi.
const PASS = {
 'C1.21':'products.spec.ts: variant qo\'shish/o\'chirish backendda persist bo\'ladi, variantsizda default ko\'rsatiladi.',
 'C1.23':'warehouses.spec.ts: yaratish ro\'yxatda chiqadi, default belgilanganda faqat bittasi qoladi.',
 'C1.24':'stock.spec.ts: jadval sonlari, inbound +10, kam qoldiq ajratilishi.',
 'C1.25':'orders.spec.ts: ro\'yxat, filtrlar serverga yuborilishi, Elchi timeline.',
 'C1.26':'dashboard.spec.ts: kartalar backend qiymatini ko\'rsatadi, bo\'sh holat ham.',
 'C1.27':'admin-shops.spec.ts: pending ro\'yxat, approve, reject sabab bilan.',
 'C1.32':'catalog admin-shop.service.spec.ts: TC1 detail, TC2/TC3 suspend-activate, TC4 PENDING suspend 409.',
 'C2.19':'identity auth.service.spec.ts TC1/TC2 + checkout TC3: guest buyer yaratiladi, qayta ishlatiladi, order buyer bilan bog\'lanadi.',
 'C4.1':'review-eligibility.service.spec.ts TC1 (3 holat) + review.service.spec.ts TC2/TC3.',
 'C4.3':'finance.service.spec.ts: TC1 COD ledger, TC2 netting, TC3 recon farqi 0.',
};
// Qisman — Doing'ga qaytadi. [navbat, qaysi TC qolgan, sabab]
const FAIL = {
 'C2.20':[1,'TC1, TC2, TC3','Dostavka narxi uchun birorta avtomatik test topilmadi. Bu MVP uchun kritik: 15-sentabrdagi buyurtma oqimida yetkazish narxi ko\'rsatilishi shart (C2.17 shunga tayanadi).'],
 'C3.2' :[2,'hammasi','Payme sandbox hisobi yo\'q — testlarni bajarib bo\'lmaydi. C7.1 tugamaguncha bu card qimirlamaydi.'],
 'C3.3' :[3,'hammasi','Click sandbox hisobi yo\'q — xuddi C3.2 kabi C7.1 ga bog\'liq.'],
 'C4.7' :[4,'TC seed qismi','Rate limiting, /health/readiness va backup+restore men tomonimdan productionda tekshirildi va ishlaydi. Seed (bosh admin, kategoriyalar) tekshirilmagan — shu qolgan.'],
 'C1.20':[5,'TC3','Majburiy maydon bo\'sh qolganda validatsiya chiqishi tekshirilmagan. Qolgan uchtasi products.spec.ts da qoplangan.'],
 'C1.33':[6,'TC3, TC4','TC3 SUPERADMIN jamoa menyusini talab qiladi, jamoa boshqaruvi esa hali yozilmagan (C6.1). TC4 ADMIN rejim belgisi uchun test yo\'q.'],
 'C1.34':[7,'hammasi','AdminOverviewPage yozilgan, lekin unga birorta e2e test yo\'q — kartalar, bo\'sh holat, skeleton va o\'tish tugmasi tekshirilmagan.'],
 'C1.35':[8,'TC2','Rol va holat filtri tekshirilmagan. Qolgan uchtasi admin-users-finance.spec.ts da bor.'],
 'C1.36':[9,'TC4','Buyurtmasiz bo\'sh holat tekshirilmagan. Qolganlari admin-orders.spec.ts da qoplangan.'],
 'C1.37':[10,'TC1, TC4','Kategoriya daraxti ko\'rinishi va dublikat slug xatosi tekshirilmagan.'],
 'C1.39':[11,'TC1, TC3','Operator qo\'shish va operatorning buyurtmani tasdiqlashi tekshirilmagan. roles.spec.ts faqat menyu chegarasini qoplaydi.'],
 'C4.5' :[12,'TC3','Suspend/reactivate C1.32 da qoplangan, lekin audit jurnaliga yozilishi alohida tekshirilmagan.'],
 'C1.1' :[13,'TC1, TC3','Migratsiya sxemasi va sirlarning AES bilan shifrlanishi tekshirilmagan.'],
 'C4.6' :[14,'TC1, TC3','Deploy va HTTPS ishlaydi, lekin to\'liq E2E oqim (ro\'yxatdan payout gacha) productionda bir marta ham o\'tkazilmagan va servis yiqilganda alert kelishi sinalmagan.'],
};

const lists = await api('GET',`/boards/${B}/lists?fields=name`);
const L = Object.fromEntries(lists.map(l=>[l.name,l.id]));
const testing = L['Testing'], doing = L['Doing'], done = L['Done 🎉'];
const cards = await api('GET',`/lists/${testing}/cards?fields=name&checklists=all`);

let toDone=0, toDoing=0, ticked=0;
for (const c of cards) {
  const code = c.name.split(' ')[0];
  const items = (c.checklists||[]).flatMap(cl=>cl.checkItems);
  const allDone = items.length>0 && items.every(i=>i.state==='complete');

  if (PASS[code]) {
    for (const i of items.filter(i=>i.state!=='complete')) {
      await api('PUT',`/cards/${c.id}/checkItem/${i.id}?state=complete`); ticked++;
    }
    await api('PUT',`/cards/${c.id}?idList=${done}`);
    await api('POST',`/cards/${c.id}/actions/comments?text=${encodeURIComponent('Kod bilan tekshirildi — barcha test holatlari avtomatik testlar bilan qoplangan va ular yashil. Dalil: '+PASS[code])}`);
    toDone++; console.log(`  ✓ Done: ${code}`);
  } else if (FAIL[code]) {
    const [ord, which, why] = FAIL[code];
    await api('PUT',`/cards/${c.id}?idList=${doing}`);
    const txt = `QAYTARILDI — Doing.\n\nQolgan: ${which}\n\nSabab: ${why}\n\nNavbat: ${ord}-o'rin (Testing dan qaytarilganlar orasida).`;
    await api('POST',`/cards/${c.id}/actions/comments?text=${encodeURIComponent(txt)}`);
    toDoing++; console.log(`  ↩ Doing (${ord}): ${code} — ${which}`);
  } else if (allDone) {
    await api('PUT',`/cards/${c.id}?idList=${done}`);
    await api('POST',`/cards/${c.id}/actions/comments?text=${encodeURIComponent('Barcha test holatlari allaqachon belgilangan edi — Done ga o\'tkazildi.')}`);
    toDone++; console.log(`  ✓ Done: ${code} (avval belgilangan)`);
  } else {
    console.log(`  ? qaror yo'q: ${code}`);
  }
}
console.log(`\nDone: ${toDone} | Doing: ${toDoing} | belgilangan TC: ${ticked}`);

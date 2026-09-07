// Doing'dagi cardlarni Backlog'ga qaytaradi va butun Backlog'ni muddat
// bo'yicha tartiblaydi: muddati yaqinlari tepada, uzoqlari pastda.
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

const lists = await api('GET',`/boards/${B}/lists?fields=name`);
const backlog = lists.find(l=>l.name==='Backlog').id;
const doing   = lists.find(l=>l.name==='Doing').id;

// 1) Doing -> Backlog
const doingCards = await api('GET',`/lists/${doing}/cards?fields=name`);
for (const c of doingCards) {
  await api('PUT',`/cards/${c.id}?idList=${backlog}`);
  console.log(`  ← Backlog: ${c.name.split(' ')[0]}`);
}

// 2) Backlog'ni muddat bo'yicha tartiblash
const cards = await api('GET',`/lists/${backlog}/cards?fields=name,due`);
cards.sort((a,b) => {
  if (!a.due && !b.due) return a.name.localeCompare(b.name);
  if (!a.due) return 1;          // muddatsizlar eng pastga
  if (!b.due) return -1;
  return a.due.localeCompare(b.due) || a.name.localeCompare(b.name);
});
let pos = 1000;
for (const c of cards) {
  await api('PUT',`/cards/${c.id}?pos=${pos}`);
  pos += 1000;
}
console.log(`\nBacklog'ga ko'chirildi: ${doingCards.length}`);
console.log(`Muddat bo'yicha tartiblandi: ${cards.length} ta card`);

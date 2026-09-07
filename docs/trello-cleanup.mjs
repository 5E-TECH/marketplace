// Boarddagi to'liqmas cardlarni tuzatadi:
//   1) Trello shablonidan qolgan bo'sh kartalarni arxivlaydi (o'chirmaydi),
//   2) yorliqsiz cardlarga yorliq qo'yadi,
//   3) a'zosiz haqiqiy cardlarga egasini biriktiradi.
import { readFileSync } from 'node:fs';
const B = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
let key=process.env.TRELLO_KEY, token=process.env.TRELLO_TOKEN;
if(!key||!token) for(const l of readFileSync('.env.trello','utf8').split('\n')){
  const m=l.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
  if(m?.[1]==='TRELLO_KEY') key||=m[2]; else if(m) token||=m[2];
}
const auth=`key=${key}&token=${token}`, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(m,p)=>{const r=await fetch(`https://api.trello.com/1${p}${p.includes('?')?'&':'?'}${auth}`,{method:m});
  if(!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${await r.text()}`); await sleep(120); return r.status===204?null:r.json();};

// Trello shabloni bilan kelgan, vazifa bo'lmagan kartalar
const TEMPLATE = ['Backlog','Doing','Testing','Done','Done 🎉','[Example task]','[Completed task]'];

// Yorliqsiz qolgan haqiqiy cardlar
const LABELS = {
  'C1.38':'Phase 1;Backend-Core;Normal;M',
  'C1.39':'Phase 1;Frontend;Normal;M',
  'C2.19':'Phase 2;Backend-Commerce;High;M',
  'C2.20':'Phase 2;Backend-Commerce;High;M',
  'C2.21':'Phase 2;Frontend;High;M',
  'C4.7':'Phase 4;DevOps;High;M',
};
// Done'dagi eski, egasiz cardlar
const OWNERS = {
  'Database tableini tuzib chiqish':['Lead','Phase 0;Backend-Core;High;M'],
  'TZ ni birgalikda tahlil qilish':['Lead','Phase 0;DevOps;High;S'],
};
const MEMBER={Lead:'shodiyorergashev',Dilshodbek:'urozov04',Bahodir:'nabijanov'};

const [labels,members,cards]=await Promise.all([
  api('GET',`/boards/${B}/labels`), api('GET',`/boards/${B}/members?fields=username`),
  api('GET',`/boards/${B}/cards?fields=name,idMembers,idLabels`)]);
const labelId=new Map(labels.filter(l=>l.name).map(l=>[l.name,l.id]));
const memberId=new Map(members.map(m=>[m.username,m.id]));

let archived=0, labeled=0, assigned=0;

for(const c of cards){
  // 1) shablon kartalari
  if(TEMPLATE.includes(c.name)){
    await api('PUT',`/cards/${c.id}?closed=true`);
    archived++; console.log(`  ⌫ arxivlandi: ${c.name}`);
    continue;
  }
  const code=c.name.split(' ')[0];
  // 2) yorliq
  const want = LABELS[code] || OWNERS[c.name]?.[1];
  if(want && !c.idLabels.length){
    const ids=want.split(';').map(n=>labelId.get(n.trim())).filter(Boolean);
    for(const id of ids) await api('POST',`/cards/${c.id}/idLabels?value=${id}`);
    labeled++; console.log(`  🏷 yorliq: ${c.name.slice(0,44)} → ${want}`);
  }
  // 3) a'zo
  const who = OWNERS[c.name]?.[0];
  if(who && !c.idMembers.length){
    await api('POST',`/cards/${c.id}/idMembers?value=${memberId.get(MEMBER[who])}`);
    assigned++; console.log(`  👤 a'zo: ${c.name.slice(0,44)} → ${who}`);
  }
}
console.log(`\nArxivlandi: ${archived} | yorliq: ${labeled} | a'zo: ${assigned}`);

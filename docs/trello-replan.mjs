// Jadvalni 7-sentabrdan boshlab qayta quradi + Dilshodbek uchun to'siq cardini yaratadi.
import { readFileSync } from 'node:fs';
import { newCard, dues } from '/tmp/replan.mjs';
const B = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
let key=process.env.TRELLO_KEY, token=process.env.TRELLO_TOKEN;
if(!key||!token) for(const l of readFileSync('.env.trello','utf8').split('\n')){
  const m=l.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
  if(m?.[1]==='TRELLO_KEY') key||=m[2]; else if(m) token||=m[2];
}
const auth=`key=${key}&token=${token}`, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(m,p)=>{const r=await fetch(`https://api.trello.com/1${p}${p.includes('?')?'&':'?'}${auth}`,{method:m});
  if(!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${await r.text()}`); await sleep(120); return r.status===204?null:r.json();};

const [lists,labels,members]=await Promise.all([
  api('GET',`/boards/${B}/lists?fields=name`), api('GET',`/boards/${B}/labels`), api('GET',`/boards/${B}/members?fields=username`)]);
const backlog=lists.find(l=>l.name==='Backlog').id, doneId=lists.find(l=>l.name.startsWith('Done')).id;
const labelId=new Map(labels.filter(l=>l.name).map(l=>[l.name,l.id]));
const memberId=new Map(members.map(m=>[m.username,m.id]));

let cards=await api('GET',`/boards/${B}/cards?fields=name,idList,due`);
if(!cards.find(c=>c.name.startsWith(newCard.code+' '))){
  const q=new URLSearchParams({name:newCard.name,desc:newCard.desc,idList:backlog,due:`${newCard.due}T12:00:00.000Z`});
  const ids=newCard.labels.split(';').map(n=>labelId.get(n.trim())).filter(Boolean).join(','); if(ids) q.set('idLabels',ids);
  q.set('idMembers', memberId.get('urozov04'));
  const made=await api('POST',`/cards?${q}`);
  const cl=await api('POST',`/checklists?idCard=${made.id}&name=${encodeURIComponent("🧪 Test (Done'dan oldin)")}`);
  for(const t of newCard.tests) await api('POST',`/checklists/${cl.id}/checkItems?name=${encodeURIComponent(t)}`);
  console.log(`  + ${newCard.code} → Dilshodbek (to'siqni o'zi hal qiladi)`);
}

cards=await api('GET',`/boards/${B}/cards?fields=name,idList,due`);
const open=cards.filter(c=>c.idList!==doneId && !['Backlog','Doing','Testing','[Example task]'].includes(c.name));
let n=0, miss=[];
for(const c of open){
  const code=c.name.split(' ')[0];
  if(!dues[code]){ miss.push(code); continue; }
  const due=`2026-${dues[code]}T12:00:00.000Z`;
  if(c.due!==due){ await api('PUT',`/cards/${c.id}?due=${due}`); n++; }
}
console.log(`\nMuddat yangilandi: ${n}`);
if(miss.length) console.log(`Jadvalsiz: ${miss.join(', ')}`);

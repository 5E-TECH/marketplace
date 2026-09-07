// Qo'lda qabul testlari cardlarini yaratadi. Idempotent.
import { readFileSync } from 'node:fs';
import cards from './manual-test-cards.mjs';
const B = process.env.TRELLO_BOARD_ID || '683723494d29ae9b65efafcc';
let key=process.env.TRELLO_KEY, token=process.env.TRELLO_TOKEN;
if(!key||!token) for(const l of readFileSync('.env.trello','utf8').split('\n')){
  const m=l.match(/^\s*(TRELLO_KEY|TRELLO_TOKEN)\s*=\s*(.+?)\s*$/);
  if(m?.[1]==='TRELLO_KEY') key||=m[2]; else if(m) token||=m[2];
}
const auth=`key=${key}&token=${token}`, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(m,p)=>{const r=await fetch(`https://api.trello.com/1${p}${p.includes('?')?'&':'?'}${auth}`,{method:m});
  if(!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${await r.text()}`); await sleep(120); return r.status===204?null:r.json();};
const MEMBER={Lead:'shodiyorergashev',Dilshodbek:'urozov04',Bahodir:'nabijanov'};
const CHECKLIST="🧪 Test (Done'dan oldin)";

const [lists,labels,members]=await Promise.all([
  api('GET',`/boards/${B}/lists?fields=name`), api('GET',`/boards/${B}/labels`), api('GET',`/boards/${B}/members?fields=username`)]);
const backlog=lists.find(l=>l.name==='Backlog').id;
const labelId=new Map(labels.filter(l=>l.name).map(l=>[l.name,l.id]));
const memberId=new Map(members.map(m=>[m.username,m.id]));

// "Qo'lda test" yorlig'i
if(!labelId.get("Qo'lda test")){
  const made=await api('POST',`/labels?name=${encodeURIComponent("Qo'lda test")}&color=pink&idBoard=${B}`);
  labelId.set("Qo'lda test", made.id);
  console.log("  Yorliq yaratildi: Qo'lda test (pink)");
}
const mvpL=labelId.get('MVP 15-sen');

const existing=await api('GET',`/boards/${B}/cards?fields=name`);
let n=0;
for(const c of cards){
  if(existing.find(x=>x.name.startsWith(c.code+' '))) { console.log(`  = bor: ${c.code}`); continue; }
  const q=new URLSearchParams({name:c.name,desc:c.desc,idList:backlog,due:`${c.due}T12:00:00.000Z`});
  const ids=c.labels.split(';').map(x=>labelId.get(x.trim())).filter(Boolean);
  if(c.mvp && mvpL) ids.push(mvpL);
  if(ids.length) q.set('idLabels', ids.join(','));
  const mid=memberId.get(MEMBER[c.member]); if(mid) q.set('idMembers',mid);
  const made=await api('POST',`/cards?${q}`);
  const cl=await api('POST',`/checklists?idCard=${made.id}&name=${encodeURIComponent(CHECKLIST)}`);
  for(const t of c.tests) await api('POST',`/checklists/${cl.id}/checkItems?name=${encodeURIComponent(t)}`);
  n++;
  console.log(`  + ${c.code} → ${c.member}${c.mvp?'  [MVP]':''}`);
}
console.log(`\nYaratildi: ${n}`);

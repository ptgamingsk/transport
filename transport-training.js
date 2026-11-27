import {doc,collection,getDocsFromServer,getDocFromServer,setDoc,serverTimestamp,onSnapshot} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
const questions=[
['Čo urobíš pri poruche vozidla?',['Pokračujem bez hlásenia','Bezpečne zastavím a informujem dispečing','Odhlásim sa bez vysvetlenia'],1],
['Ako používaš PTT?',['Podržím tlačidlo počas hovoru','Stlačím ho až po hovore','Nechám mikrofón stále vysielať'],0],
['Čo urobíš pri meškaní?',['Zatajím ho','Zrýchlim bez ohľadu na pravidlá','Informujem dispečing'],2],
['Ako komunikuješ s kolegami?',['Slušne a vecne','Urážkami','Prekrikovaním'],0],
['Kedy použiješ SOS?',['Pri každej prestávke','Pri vážnej hernej mimoriadnej udalosti','Na skúšanie zvuku'],1],
['Čo urobíš pred jazdou?',['Ignorujem pridelenie','Vyberiem ľubovoľné vozidlo','Skontrolujem pridelenú službu a vozidlo'],2],
['Ako ukončíš vysielanie?',['Pustím tlačidlo PTT','Vypnem počítač','Nechám tlačidlo stlačené'],0],
['Čo platí pri jazde?',['Meškanie ospravedlňuje všetko','Dodržiavam dopravné pravidlá simulátora','Pravidlá neplatia'],1],
['Kto schvaľuje skúšobnú dobu?',['Samotný vodič','Náhodný kolega','Riaditeľ'],2],
['Kde sleduješ pokyny vedenia?',['Vo firemných oznamoch a pravidlách','Nikde','Iba v hre'],0]];
const score=a=>questions.reduce((n,q,i)=>n+(a?.[i]===q[2]?1:0),0);
const el=(tag,txt,cls)=>{const x=document.createElement(tag);if(txt)x.textContent=txt;if(cls)x.className=cls;return x};
export function createTraining(db,notify=()=>{}){
 let unsub,watchUid,seen=new Set(),generation=0;
 function close(){generation++;unsub?.();unsub=undefined;watchUid=undefined;seen.clear()}
 function watch(uid){if(watchUid===uid)return;close();watchUid=uid;unsub=onSnapshot(collection(db,'transportSOS'),snap=>{for(const d of snap.docs){const a=d.data(),k=d.id+':'+(a.created?.toMillis?.()||0);if(a.status==='pending'&&!seen.has(k)){seen.add(k);notify('sos:'+k,'SOS – '+a.name,a.reason)}}},()=>{});}
 async function show(host,uid,owner,name='',mode='training'){
 const g=++generation;host.replaceChildren();const root=el('section','','panel');host.append(root);root.append(el('h2',owner?'Školenie vodičov / skúšobná doba / SOS':mode==='sos'?'SOS – núdzové hlásenie':'Školenie vodiča'));const msg=el('p','Načítavam…','muted');root.append(msg);
 const alive=()=>g===generation&&root.isConnected;
 const button=(label,fn,parent=root)=>{const b=el('button',label,'secondary');b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn()}catch(e){if(alive())msg.textContent='Operácia zlyhala: '+e.message}finally{b.disabled=false}};parent.append(b);return b};
 const ref=(c,id=uid)=>doc(db,c,id);
 try{
 if(owner){
 const [accounts,tests,probs,sos]=await Promise.all(['driverAccounts','transportTraining','transportProbation','transportSOS'].map(c=>getDocsFromServer(collection(db,c))));
 if(!alive())return;msg.textContent='Výsledky školení a schvaľovanie vodičov.';
 const map=s=>new Map(s.docs.map(d=>[d.id,d.data()]));const t=map(tests),p=map(probs);
 root.append(el('h3','SOS hlásenia'));
 for(const d of sos.docs){const a=d.data();const row=el('div','','panel');row.append(el('p',a.name+' · '+a.reason+' · '+a.status+' · '+(a.created?.toDate?.().toLocaleString('sk-SK')||'')));root.append(row);for(const [label,status] of [['Potvrdiť','acknowledged'],['Vyriešiť','resolved']])if(a.status!=='resolved'&&a.status!==status)button(label,async()=>{await setDoc(ref('transportSOS',d.id),{status},{merge:true});await show(host,uid,true)},row)}
 root.append(el('h3','Vodiči'));
 for(const d of accounts.docs.filter(d=>d.data().enabled)){const a=d.data(),test=t.get(d.id),prob=p.get(d.id),n=score(test?.answers);const row=el('div','','panel');root.append(row);row.append(el('h3',a.name),el('p',test?'Test: '+n+'/10 · '+(n>=8?'úspešný':'neúspešný'):'Test neabsolvovaný'),el('p','Stav: '+(prob?.status==='approved'?'Riadny vodič':prob?.status==='trial'?'Skúšobná doba do '+prob.until:'Bez evidovanej skúšobnej doby')));
 const date=el('input');date.type='date';date.value=new Date(Date.now()+14*86400000).toISOString().slice(0,10);row.append(date);
 button('Nastaviť skúšobnú dobu',async()=>{if(!date.value)throw Error('Vyber dátum');await setDoc(ref('transportProbation',d.id),{status:'trial',until:date.value,updated:serverTimestamp()});await show(host,uid,true)},row);
 if(n>=8)button('Schváliť vodiča',async()=>{const fresh=await getDocFromServer(ref('transportTraining',d.id));if(score(fresh.data()?.answers)<8)throw Error('Test nie je úspešný');await setDoc(ref('transportProbation',d.id),{status:'approved',updated:serverTimestamp()});await show(host,uid,true)},row);
 }
 }else{
 const [test,prob,sos]=await Promise.all(['transportTraining','transportProbation','transportSOS'].map(c=>getDocFromServer(ref(c))));
 if(!alive())return;const a=test.data(),p=prob.data(),s=sos.data();msg.textContent=a?'Posledný výsledok: '+score(a.answers)+'/10':'Test ešte neabsolvovaný.';
 if(mode!=='sos'){
 root.append(el('p','Skúšobná doba: '+(p?.status==='trial'?'do '+p.until:p?.status==='approved'?'Schválený vodič':'Bez evidovanej skúšobnej doby')));
 root.append(el('p','Pred testom si prečítaj sekciu Pravidlá spoločnosti. Úspešnosť: 8 z 10.'));
 const form=el('form');root.append(form);
 questions.forEach((q,i)=>{const f=el('fieldset');f.style.cssText='border:1px solid #354044;border-radius:8px;padding:12px;margin:12px 0';f.append(el('legend',(i+1)+'. '+q[0]));q[1].forEach((v,j)=>{const l=el('label'),r=el('input');r.type='radio';r.name='q'+i;r.value=j;r.required=true;l.style.cssText='display:flex;align-items:center;gap:10px;padding:8px;cursor:pointer';r.style.cssText='width:auto;min-width:0;margin:0;accent-color:#a3ed42';l.append(r,document.createTextNode(' '+v));f.append(l)});form.append(f)});
 const submit=el('button','Odovzdať test','primary');submit.type='submit';form.append(submit);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const data=new FormData(form),answers=questions.map((_,i)=>Number(data.get('q'+i)));await setDoc(ref('transportTraining'),{answers,submitted:serverTimestamp()});if(alive())msg.textContent='Výsledok: '+score(answers)+'/10 · '+(score(answers)>=8?'Úspešný':'Neúspešný')}catch(e){msg.textContent=e.message}finally{submit.disabled=false}};
 }
 if(mode==='sos'){
 msg.textContent='Núdzové hlásenie dispečingu';root.append(el('h3','SOS – herná mimoriadna udalosť'),el('p','Nie je určené na privolanie skutočnej záchrannej služby.'));if(s&&s.status!=='resolved')root.append(el('p','Aktívne hlásenie: '+s.status));else{const reason=el('input');reason.placeholder='Dôvod hlásenia';reason.maxLength=300;root.append(reason);const b=button('SOS – upozorniť dispečing',async()=>{if(!reason.value.trim())throw Error('Zadaj dôvod');await setDoc(ref('transportSOS'),{name,reason:reason.value.trim(),status:'pending',created:serverTimestamp()});await show(host,uid,false,name,'sos')});b.style.background='#a51e2d';b.style.color='white'}
 }
 }
 }catch(e){if(alive())msg.textContent='Údaje sa nepodarilo načítať. '+e.message}
 }
 return {show,watch,close};
}

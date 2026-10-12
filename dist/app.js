import { noteName, allPositions, sanitizeProgress, recordAnswer } from './engine.js';
import { ROOTS, makePosition, candidatesFor, createJourney, advancePosition, beginRecall, markHint, makeTransfers, createSequence, describeMove, parseNote } from './journey.js';
import { GuitarAudio } from './audio.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const safe=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nn=pc=>noteName(pc), pos=p=>`${p.string}弦${p.fret===0?'・開放弦':p.fret+'フレット'}`;
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const prefRaw=read('fret-atlas.path-settings.v2',{});
let prefs={root:ROOTS.includes(prefRaw?.root)?prefRaw.root:0,sound:prefRaw?.sound!==false};
let progress=sanitizeProgress(read('fret-atlas.progress.v1',null));
function cleanHistory(value){return Array.isArray(value)?value.filter(v=>v&&ROOTS.includes(v.root)&&Array.isArray(v.route)&&v.route.length===6&&v.route.every(p=>Number.isInteger(p.string)&&p.string>=1&&p.string<=6&&Number.isInteger(p.fret)&&p.fret>=0&&p.fret<=12)&&Number.isFinite(v.at)).slice(-60).map(v=>({root:v.root,at:v.at,route:v.route.map(p=>makePosition(p.string,p.fret)),clean:Math.min(5,Math.max(0,Number(v.clean)||0)),mistakes:Math.max(0,Number(v.mistakes)||0),hints:Math.max(0,Number(v.hints)||0)})):[];}
let history=cleanHistory(read('fret-atlas.paths.v2',[]));
let journey=createJourney(prefs.root), transfers=[], cleanRecall=0, currentMissed=false;
let free=false, freeFilter=null, showNames=false, lastTouched=journey.route[0];
let wrong=null, hintNodes=[], pickedRoot=prefs.root, padVisible=false, phrase=[], phraseIndex=0, phraseHint=false;
let recallPeeked=false, earMistakes=0, earHints=0, earFinished=false;
let feedback=null, playToken=0, sounding=null, completionSaved=false, questionStarted=performance.now(), toastTimer;
const guitar=new GuitarAudio();
const mod=n=>(n%12+12)%12;
const activeTask=()=>journey.phase==='transfer'?transfers[journey.transferIndex]:null;
function save(){try{localStorage.setItem('fret-atlas.progress.v1',JSON.stringify(progress));localStorage.setItem('fret-atlas.paths.v2',JSON.stringify(history));localStorage.setItem('fret-atlas.path-settings.v2',JSON.stringify(prefs));}catch{$('#save-status').textContent='保存できません。この画面では練習を続けられます。';}}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function stopPlayback(){playToken++;sounding=null;guitar.stop();}
async function sound(p,forced=false){if(!prefs.sound&&!forced)return false;const token=playToken;const ok=await guitar.play(p.midi,{volume:.48});if(!ok&&token===playToken)toast('音を再生できません。音名と位置で練習を続けられます。');return ok;}
async function playPath(path,{show=true,force=false}={}){
  stopPlayback();if(!path.length)return;
  if(!prefs.sound&&!force){toast('音はオフです。設定から切り替えられます。');return;}
  const token=playToken;
  $('#listen-button').classList.add('playing');
  for(const p of path){if(token!==playToken)break;sounding=show?p.id:null;renderBoard();if(!await sound(p,force))break;await new Promise(resolve=>setTimeout(resolve,500));}
  if(token===playToken){sounding=null;$('#listen-button').classList.remove('playing');renderBoard();}
}
function remember(p,correct,assisted){recordAnswer(progress,p,{correct,assisted,elapsedMs:Math.min(120000,Math.max(0,performance.now()-questionStarted))});questionStarted=performance.now();save();}
function setFeedback(title,detail,kind='neutral'){feedback={title,detail,kind};}
function fresh(root=prefs.root){stopPlayback();prefs.root=root;journey=createJourney(root);transfers=[];cleanRecall=0;currentMissed=false;free=false;wrong=null;hintNodes=[];phrase=[];phraseIndex=0;phraseHint=false;padVisible=false;lastTouched=journey.route[0];completionSaved=false;recallPeeked=false;earMistakes=0;earHints=0;earFinished=false;feedback=null;questionStarted=performance.now();save();render();requestAnimationFrame(()=>centerOn(lastTouched));}
function activeString(){if(free)return null;if(journey.phase==='ear')return 3;const t=activeTask();return t?.kind==='locate'?t.string:journey.activeString;}
function activePath(){return journey.phase==='recall'?journey.recall:journey.route;}
function countText(){if(free)return['78','','PLAYABLE POSITIONS'];if(journey.phase==='discover')return[journey.route.length,'/ 6','STRINGS CONNECTED'];if(journey.phase==='recall')return[journey.recall.length,'/ 6','BACK BY MEMORY'];if(journey.phase==='ear')return[phraseIndex,'/ 4','NOTES HEARD'];return[journey.transferIndex,'/ 3','NEW CONNECTIONS'];}
function render(){
  const completed=journey.done&&journey.phase!=='ear'&&!free;
  $('#studio').hidden=completed;$('#completion').hidden=!completed;
  $('#free-toggle').setAttribute('aria-pressed',String(free));$('#free-toggle').innerHTML=free?'↙ 練習に戻る':'<span>↗</span> 自由に弾く';
  $('#root-letter').textContent=nn(journey.rootPc);$('#archive-count').textContent=String(history.length).padStart(2,'0');
  $$('[data-phase]').forEach(b=>{const step=b.dataset.phase,active=step===journey.phase||step==='transfer'&&journey.phase==='ear';b.classList.toggle('active',active&&!free);b.classList.toggle('finished',step==='discover'&&journey.route.length===6||step==='recall'&&journey.recall.length===6||step==='transfer'&&journey.done);if(active&&!free)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
  if(completed){renderCompletion();return;}
  const t=activeTask(), [count,total,label]=countText();$('#meter-count').textContent=count;$('#meter-total').textContent=total;$('#meter-label').textContent=label;
  $('#free-controls').hidden=!free;$('#name-entry').hidden=free||t?.kind!=='name';$('#phrase-strip').hidden=free||journey.phase!=='ear';
  $('#instruction-block').hidden=!free&&(t?.kind==='name'||journey.phase==='ear');
  $('#pad-toggle').hidden=free||t?.kind!=='name';$('#note-pad').hidden=!padVisible||free||t?.kind!=='name';
  const phaseDone=!free&&['discover','recall'].includes(journey.phase)&&journey.activeString===null;
  $('#continue-button').hidden=!phaseDone;$('#hint-button').hidden=free||phaseDone;$('#hint-button').disabled=hintNodes.length>0||phraseHint;
  $('#listen-button').hidden=phaseDone;
  $('#listen-button').innerHTML=journey.phase==='ear'&&!free?'<span>♪</span> フレーズを聴く':'<span>♪</span> 音を聴く';
  let title,description,dock,kicker;
  if(free){kicker='SIDE A / PLAY THE FRETBOARD';title='寄り道も、音楽。';description='触った場所の音が鳴ります。つながった道も、自由に聴き比べてみよう。';dock='音名を見せたり、ひとつの音だけを浮かび上がらせたり。';renderFilters();}
  else if(journey.phase==='discover'){
    kicker='01 / MAKE A PATH';title=phaseDone?`${nn(journey.rootPc)}が、6本の弦につながった。`:`${journey.activeString}弦にも、${nn(journey.rootPc)}を。`;
    description=phaseDone?'いま作った形を、ひと呼吸だけ見ておこう。次は、線と音名が消えます。':`いまは${journey.activeString}弦。${nn(journey.rootPc)}のある場所をタップして、道をつなごう。`;
    dock=phaseDone?'見本がなくても、戻ってこられる？':`いま探すのは <strong>${journey.activeString}弦の${nn(journey.rootPc)}</strong>。`;
    $('#continue-button').innerHTML='地図を消して、もう一度 <span>→</span>';
  }else if(journey.phase==='recall'){
    kicker='02 / TRUST YOUR MEMORY';title=phaseDone?'見えなくても、戻ってこられた。':'今度は、記憶で。';
    description=phaseDone?'今度は、その道を手がかりに別の音名を読んでみよう。':`さっきと逆向きに、${journey.activeString}弦の${nn(journey.rootPc)}へ。上から、記憶でたどろう。`;
    dock=phaseDone?'覚えたひとつの音から、ほかの音が見えてくる。':`<strong>${journey.activeString}弦の${nn(journey.rootPc)}</strong>。場所を思い出してみよう。`;
    $('#continue-button').innerHTML='この道から、別の音へ <span>→</span>';
  }else if(journey.phase==='transfer'){
    kicker='03 / TAKE IT FURTHER';title=t?.kind==='name'?'ここに、音名を。':`${nn(t.pc)}の道も、つなげられる？`;
    description=t?.kind==='name'?`${pos(t.position)}。自分が作った${nn(journey.rootPc)}の道が、手がかりです。`:`さっき答えた${nn(t.pc)}を、6弦でも探してみよう。`;
    dock=t?.kind==='locate'?`<strong>6弦の${nn(t.pc)}</strong>をタップ。名前は同じ、高さは変わってもOK。`:'';
  }else{
    kicker='ENCORE / FOLLOW YOUR EARS';title='この地図で、4音。';description=prefs.sound?'フレーズを聴いて、3弦で再現。最初の音は、いま覚えた音です。':'音はオフ。表示された4音を、3弦でつないでみよう。';dock='';
    $('#phrase-strip').innerHTML=phrase.map((p,i)=>`<span class="phrase-chip ${i<phraseIndex?'filled':''} ${i===phraseIndex?'current':''}"><small>0${i+1}</small>${i<phraseIndex||phraseHint||!prefs.sound?nn(p.pc):'♪'}</span>`).join('');
  }
  $('#stage-label').textContent=kicker;$('#mission-title').textContent=title;$('#mission-description').textContent=description;$('#dock-copy').innerHTML=dock;
  const defaultFeedback=free?{title:'触れた音を、確かめる。',detail:'指板は矢印キーで移動、Enterで発音もできます。',kind:'neutral'}:journey.phase==='recall'?{title:'思い出す時間も、練習のうち。',detail:'わからなくなったら「道しるべ」。その位置だけ、もう一度見られます。',kind:'neutral'}:journey.phase==='transfer'?{title:'自分で作った道を、使ってみよう。',detail:'1フレットは半音。E–F、B–Cの間も1フレットです。',kind:'neutral'}:{title:'音の居場所を、線にしてみよう。',detail:'光っている弦をタップ。間違えた場所の音も、手がかりになります。',kind:'neutral'};
  const f=feedback||defaultFeedback;$('#feedback-line').className=`feedback-line ${f.kind}`;$('#feedback-title').textContent=f.title;$('#feedback-detail').textContent=f.detail;$('#feedback-icon').textContent=f.kind==='correct'?'↗':f.kind==='wrong'?'↳':'*';
  const p=lastTouched;$('#board-message').textContent=p?`${pos(p)} / ${nn(p.pc)}${Math.floor(p.midi/12)-1}`:'ひとつずつ、触ってみよう。';
  if(!free&&t?.kind==='name')$('#board-message').textContent=`探す場所：${pos(t.position)} / ?`;
  $('#lesson-copy').innerHTML=journey.phase==='recall'?'<strong>線を覚えるだけで、終わらせない。</strong> 次は、この道の隣にある音を、名前で答えてもらいます。':journey.phase==='transfer'?'<strong>ひとつ分かると、隣も分かる。</strong> 音名・半音の距離・弦の位置を、一緒に使ってみよう。':'<strong>同じ名前、違う居場所。</strong> 同じ音名でも、弦や場所によってオクターブが変わります。位置を触って、その違いも聴いてみよう。';
  renderBoard();renderRibbon();
}

const BOARD={w:1240,h:374,left:137,right:1203,top:53,gap:49};
const xFor=f=>f===0?103:BOARD.left+(f-.5)*(BOARD.right-BOARD.left)/12;
const yFor=s=>BOARD.top+(s-1)*BOARD.gap;
function drawPath(path,{opacity=1,color='#e35736',width=3,dashed=false}={}){
  if(path.length<2)return'';
  const d=path.map((p,i)=>i===0?`M${xFor(p.fret)},${yFor(p.string)}`:`L${xFor(p.fret)},${yFor(p.string)}`).join(' ');
  return `<path class="path-line" d="${d}" fill="none" style="stroke:${color};stroke-width:${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" ${dashed?'stroke-dasharray="5 7"':''}/>`;
}
function boardSVG({small=false}={}){
  const {w,h,left,right,top,gap}=BOARD, bottom=yFor(6), active=small?null:activeString(), t=activeTask();
  let svg=`<svg class="fretboard" viewBox="0 0 ${w} ${h}" role="group" aria-label="ギター指板。上から1弦、下が6弦。左から0〜12フレット。" xmlns="http://www.w3.org/2000/svg">`;
  if(active&&!free&&!small)svg+=`<rect class="active-lane" x="6" y="${yFor(active)-23}" width="${right+12}" height="46" rx="3" fill="#e35736" opacity=".075"/><path d="M6 ${yFor(active)}h8" stroke="#e35736" stroke-width="2"/>`;
  for(let f=1;f<=12;f++)svg+=`<line class="fret-wire" x1="${left+f*(right-left)/12}" y1="${top-24}" x2="${left+f*(right-left)/12}" y2="${bottom+24}" stroke="#202523" stroke-opacity=".20" stroke-width="1.3"/>`;
  svg+=`<path d="M${left} ${top-24}V${bottom+24}" stroke="#202523" stroke-width="5"/>`;
  for(const f of[3,5,7,9,12])for(const y of f===12?[top+gap*1.5,top+gap*3.5]:[top+gap*2.5])svg+=`<circle cx="${xFor(f)}" cy="${y}" r="4" fill="#202523" opacity=".13"/>`;
  for(let s=1;s<=6;s++)svg+=`<text x="27" y="${yFor(s)+5}" fill="${s===active?'#e35736':'#74766c'}" text-anchor="middle" font-family="monospace" font-size="13">${s}</text><text x="57" y="${yFor(s)+6}" fill="#202523" font-family="Georgia,serif" font-size="19">${nn(makePosition(s,0).pc)}</text><line class="string-line" x1="${left-17}" y1="${yFor(s)}" x2="${right+9}" y2="${yFor(s)}" stroke="#202523" stroke-opacity="${active && s!==active ? .32 : .52}" stroke-width="${.7+s*.26}"/>`;
  for(let f=0;f<=12;f++)svg+=`<text x="${xFor(f)}" y="352" text-anchor="middle" fill="#63675d" font-family="monospace" font-size="12">${f===0?'OPEN':String(f).padStart(2,'0')}</text>`;
  const path=small?journey.route:activePath();
  if(small||free||journey.phase==='transfer'||journey.phase==='ear')svg+=drawPath(journey.route,{opacity:small?1:.26,dashed:!small});
  else svg+=drawPath(path,{opacity:.85});
  const additions=journey.transferAnswers.map(a=>a.position);
  if(!small&&additions.length>1)svg+=drawPath(additions.slice(1),{color:'#496cd2',opacity:.65});
  const visiblePath=small||free?journey.route:journey.phase==='recall'?journey.recall:journey.route;
  const tabId=free?(lastTouched?.id||'6-0'):t?.kind==='name'?t.position.id:active?`${active}-${Math.min(12,lastTouched?.fret||0)}`:null;
  for(const p of allPositions()){
    const x=xFor(p.fret),y=yFor(p.string),found=visiblePath.some(v=>v.id===p.id),added=additions.find(a=>a.id===p.id),isWrong=wrong?.id===p.id,isHint=hintNodes.some(h=>h.id===p.id),isName=!free&&!small&&t?.kind==='name'&&t.position.id===p.id;
    const canClick=!small&&(free||active===p.string||found||added);
    const filterMatch=free&&(freeFilter===null||p.pc===freeFilter);
    let mark='';
    if(free&&filterMatch&&(showNames||freeFilter!==null))mark=`<circle cx="${x}" cy="${y}" r="18" fill="${p.pc===journey.rootPc?'#e35736':'#dedbce'}"/><text x="${x}" y="${y+5}" text-anchor="middle" font-family="Georgia,serif" font-size="16" fill="${p.pc===journey.rootPc?'#fff9ed':'#202523'}">${nn(p.pc)}</text>`;
    else if(found&&(!free||freeFilter===null||p.pc===freeFilter))mark=`<circle class="note-node" cx="${x}" cy="${y}" r="20" fill="#e35736" opacity="${!small&&(journey.phase==='transfer'||journey.phase==='ear'||free)?'.5':'1'}"/><text x="${x}" y="${y+6}" text-anchor="middle" font-family="Georgia,serif" font-size="19" fill="#fff9ed">${nn(journey.rootPc)}</text>`;
    if(added&&!free)mark=`<circle cx="${x}" cy="${y}" r="20" fill="#496cd2"/><text x="${x}" y="${y+6}" text-anchor="middle" font-family="Georgia,serif" font-size="18" fill="white">${nn(added.pc)}</text>`;
    if(isName)mark=`<circle class="current-marker" cx="${x}" cy="${y}" r="25" fill="#202523"/><text x="${x}" y="${y+8}" text-anchor="middle" font-family="Georgia,serif" font-size="28" fill="#fff9ed">?</text>`;
    if(isHint&&!isName)mark=`<circle class="guide-node" cx="${x}" cy="${y}" r="22" fill="#f2eee5" stroke="#e35736" stroke-width="2" stroke-dasharray="4 3"/><text x="${x}" y="${y+6}" text-anchor="middle" font-size="17" fill="#e35736">${nn(p.pc)}</text>`;
    if(isWrong)mark=`<circle class="wrong-node" cx="${x}" cy="${y}" r="18" fill="#d9d9cf" stroke="#777d6b"/><text x="${x}" y="${y+6}" text-anchor="middle" font-size="17" fill="#414937">${nn(p.pc)}</text>`;
    if(sounding===p.id||free&&lastTouched?.id===p.id)mark+=`<circle class="sounding" cx="${x}" cy="${y}" r="28" fill="none" stroke="#e35736" stroke-width="2"/>`;
    const label=free||found||added?`${pos(p)}、${nn(p.pc)}を聴く`:`${pos(p)}を選ぶ`;
    svg+=`<g class="position-node ${canClick?'interactive':''}" data-position="${p.id}" ${canClick?`role="button" tabindex="${p.id===tabId?0:-1}" aria-label="${safe(label)}"`:''}><rect class="node-hit" x="${x-37}" y="${y-23}" width="74" height="46" rx="4" fill="transparent"/>${canClick?`<circle class="hover-dot" cx="${x}" cy="${y}" r="17" fill="none" stroke="#e35736" stroke-width="1.5"/>`:''}${mark}</g>`;
  }
  svg+='</svg>';return svg;
}
function renderBoard(){if($('#studio').hidden)return;const root=$('#board-scroll'),scroll=root.scrollLeft,hadFocus=root.contains(document.activeElement);root.innerHTML=boardSVG();root.scrollLeft=scroll;const scale=root.querySelector('svg').clientWidth/BOARD.w;$('#string-rail').innerHTML=Array.from({length:6},(_,i)=>`<span style="top:${yFor(i+1)*scale+14}px" class="${activeString()===i+1?'active':''}">${i+1}</span>`).join('');if(hadFocus)root.querySelector('[tabindex="0"]')?.focus({preventScroll:true});}
function centerOn(p){if(!p||$('#studio').hidden)return;const root=$('#board-scroll'),svg=root.querySelector('svg');if(!svg)return;root.scrollLeft=Math.max(0,xFor(p.fret)*svg.clientWidth/BOARD.w-root.clientWidth/2);}
function renderRibbon(){const path=free?journey.route:activePath();$('#ribbon-nodes').innerHTML=Array.from({length:6},(_,i)=>{const p=path[i];return `<span class="ribbon-item ${p?'filled':''}">${p?`<strong>${nn(p.pc)}</strong><small>${p.string}弦 / ${p.fret}F</small>`:'<span>·</span>'}</span>${i<5?'<span class="ribbon-arrow">↗</span>':''}`;}).join('');$('#route-play').disabled=path.length<1;}
function nearestTarget(p,pc=journey.rootPc){return candidatesFor(pc,p.string).sort((a,b)=>Math.abs(a.fret-p.fret)-Math.abs(b.fret-p.fret))[0];}
function nudge(from,to){const d=to.fret-from.fret;return d===0?'この場所です。':`${nn(to.pc)}は、ここから${Math.abs(d)}フレット${d>0?'右':'左'}。`;}

function choosePosition(p){
  stopPlayback();
  if(free){lastTouched=p;sound(p);setFeedback(`${nn(p.pc)}${Math.floor(p.midi/12)-1} / ${pos(p)}`,`標準チューニング。${p.fret===0?'開放弦です。':`開放弦から${p.fret}半音上。`}`);render();return;}
  if(journey.phase==='ear'){answerPhrase(p);return;}
  const t=activeTask();
  if(journey.phase==='transfer'){
    if(t?.kind==='name'){if(p.id===t.position.id)sound(p);else if(journey.route.some(v=>v.id===p.id))sound(p);return;}
    if(t?.kind==='locate'){
      if(p.string!==t.string){sound(p);toast('今度は6弦で探してみよう。');return;}
      sound(p);
      if(p.pc!==t.pc){wrong=p;currentMissed=true;journey.mistakes++;const target=nearestTarget(p,t.pc);remember(target,false,true);setFeedback(`そこは${nn(p.pc)}。${nn(t.pc)}へ、もう少し。`,nudge(p,target),'wrong');render();return;}
      remember(p,true,journey.currentAssisted||currentMissed);journey.transferAnswers.push({position:p,correct:true});journey.transferIndex++;lastTouched=p;wrong=null;finish();return;
    }
  }
  if(!journey.activeString||p.string!==journey.activeString){if(activePath().some(v=>v.id===p.id)){sound(p);setFeedback(`${pos(p)}の${nn(p.pc)}。ここが手がかり。`,'光っている弦で、同じ音名を探してみよう。');render();}return;}
  const previous=activePath().at(-1),phase=journey.phase;
  const result=advancePosition(journey,p);sound(p);
  if(!result.accepted)return;
  if(!result.correct){wrong=p;currentMissed=true;const target=nearestTarget(p);remember(target,false,true);setFeedback(`そこは${nn(p.pc)}。この音も、手がかりに。`,nudge(p,target),'wrong');render();return;}
  if(phase==='recall'&&!result.assisted&&!currentMissed&&!recallPeeked)cleanRecall++;
  remember(p,true,phase==='discover'||result.assisted||currentMissed||recallPeeked);lastTouched=p;wrong=null;hintNodes=[];currentMissed=false;
  const special=previous?.string===3&&p.string===2;
  setFeedback(special?'2弦は、チューニングが違う。':phase==='recall'?'記憶から、つながった。':`${nn(p.pc)}、つながった。`,result.message,'correct');
  render();
  if(result.completedPhase){$('#continue-button').focus({preventScroll:true});if(innerWidth<701)$('.task-dock')?.scrollIntoView({block:'nearest'});}
}
function submitName(text){
  const t=activeTask();if(free||!t||t.kind!=='name')return;
  const pc=parseNote(text);if(pc===null){setFeedback('音名で書いてみよう。','C・F#・Bb のように入力できます。ド・レ・ミでもOKです。','wrong');render();$('#note-input').focus({preventScroll:true});return;}
  if(pc!==t.answerPc){journey.mistakes++;currentMissed=true;remember(t.position,false,true);setFeedback(`${nn(pc)}ではないみたい。${nn(journey.rootPc)}の場所に戻って考えよう。`,t.octaveShift?'12フレット進むと、同じ音名に戻ります。':`覚えた${nn(journey.rootPc)}から${Math.abs(t.offset)}フレット${t.offset>0?'右':'左'}です。`,'wrong');render();$('#note-input').select();return;}
  stopPlayback();sound(t.position);remember(t.position,true,journey.currentAssisted||currentMissed);journey.transferAnswers.push({position:t.position,correct:true});journey.transferIndex++;lastTouched=t.position;wrong=null;hintNodes=[];journey.currentAssisted=false;currentMissed=false;$('#note-input').value='';setFeedback(`${nn(pc)}。自分の地図から、読めた。`,t.explanation,'correct');render();
  const next=activeTask();if(next?.kind==='name'){$('#note-input').focus({preventScroll:true});requestAnimationFrame(()=>centerOn(next.position));}else requestAnimationFrame(()=>centerOn(journey.route[0]));
}
function advancePhase(){
  stopPlayback();wrong=null;hintNodes=[];feedback=null;currentMissed=false;
  if(journey.phase==='discover'){beginRecall(journey);lastTouched=journey.recall[0];$('#board-scroll').classList.add('map-vanish');setTimeout(()=>$('#board-scroll').classList.remove('map-vanish'),700);}
  else if(journey.phase==='recall'){journey.phase='transfer';journey.activeString=null;transfers=makeTransfers(journey);journey.transferIndex=0;}
  questionStarted=performance.now();render();requestAnimationFrame(()=>centerOn(activeTask()?.position||lastTouched));if(activeTask()?.kind==='name')$('#note-input').focus({preventScroll:true});
}
function hint(){
  if(free)return;const t=activeTask();
  if(journey.phase==='ear'){phraseHint=true;earHints++;setFeedback('音名を手がかりに、耳と指板をつなごう。','このフレーズでは音名を表示します。何度でも聴き直せます。');render();return;}
  if(t){journey.hints++;journey.currentAssisted=true;if(t.kind==='name'){hintNodes=[t.anchor];setFeedback(`道しるべは${nn(journey.rootPc)}。`,t.octaveShift?t.explanation:`${pos(t.anchor)}が${nn(journey.rootPc)}。そこから${Math.abs(t.offset)}フレット${t.offset>0?'右':'左'}。1フレットは半音です。`);}else{hintNodes=candidatesFor(t.pc,t.string);setFeedback(`${nn(t.pc)}は、この場所。`,'点線の場所を触って、名前と位置を確かめよう。');}}
  else{const target=markHint(journey);if(!target)return;hintNodes=[target];const prior=activePath().at(-1);setFeedback('点線の音が、次の道しるべ。',prior?describeMove(prior,target):'点線の場所をタップしてみよう。');}
  render();requestAnimationFrame(()=>centerOn(hintNodes[0]));
}
function finish(){
  stopPlayback();journey.done=true;journey.activeString=null;
  if(!completionSaved){history.push({root:journey.rootPc,at:Date.now(),route:journey.route.map(p=>({...p})),clean:cleanRecall,mistakes:journey.mistakes,hints:journey.hints});history=history.slice(-60);completionSaved=true;save();}
  render();$('#completion').scrollIntoView({block:'start',behavior:'instant'});
}
function renderCompletion(){
  $('#completion-title').innerHTML=`${nn(journey.rootPc)}の点が、<br>あなたの道になった。`;
  $('#result-art').innerHTML=boardSVG({small:true});
  const names=transfers.length?`${nn(transfers[0].answerPc)}と${nn(transfers[1].answerPc)}`:'隣の音';
  $('#completion-message').textContent=earFinished?`${nn(journey.rootPc)}の道から、${phrase.map(p=>nn(p.pc)).join(' → ')} のフレーズまで。${!prefs.sound||phraseHint?'音名を手がかりに':'耳で聴いて'}、3弦で再現しました。`:`${nn(journey.rootPc)}を6本の弦へ。見本を消して戻り、その道を${names}へつなげました。`;
  $('#completion-stats').innerHTML=`<div class="completion-stat"><strong>${cleanRecall}<small>/ 5</small></strong><span>見本なし・一度で戻れた場所</span></div><div class="completion-stat"><strong>${journey.hints}<small>回</small></strong><span>道しるべを使った回数</span></div><div class="completion-stat"><strong>${journey.mistakes}<small>回</small></strong><span>寄り道して、確かめた回数</span></div>`;
}
function startEar(){stopPlayback();earMistakes=0;earHints=0;earFinished=false;journey.phase='ear';journey.done=true;phrase=createSequence(journey);phraseIndex=0;phraseHint=!prefs.sound;wrong=null;hintNodes=[];feedback=null;render();$('#studio').scrollIntoView({block:'start',behavior:'instant'});centerOn(phrase[0]);if(prefs.sound)playPath(phrase,{show:false});}
function answerPhrase(p){
  if(p.string!==3){sound(p);toast('フレーズは3弦でたどってみよう。');return;}
  const target=phrase[phraseIndex];if(!target)return;sound(p);
  if((!prefs.sound||phraseHint)?p.pc!==target.pc:p.midi!==target.midi){wrong=p;earMistakes++;setFeedback(`${nn(p.pc)}。聴いた音と、比べてみよう。`,'「フレーズを聴く」で、はじめから何度でも。音名が必要なら「道しるべ」。','wrong');render();return;}
  phraseIndex++;lastTouched=p;wrong=null;setFeedback(`${nn(p.pc)}。${phraseIndex}音目がつながった。`,phraseIndex===4?'4音のフレーズを、指板でたどれました。':'続く音を、3弦で探してみよう。','correct');
  if(phraseIndex===4){earFinished=true;journey.phase='transfer';render();$('#completion').scrollIntoView({block:'start',behavior:'instant'});if(prefs.sound)playPath(phrase,{show:false});}else render();
}
function renderFilters(){$('#pitch-filters').innerHTML=`<button class="pitch-filter ${freeFilter===null?'active':''}" data-pc="all" aria-pressed="${freeFilter===null}">すべて</button>`+Array.from({length:12},(_,pc)=>`<button class="pitch-filter ${freeFilter===pc?'active':''}" data-pc="${pc}" aria-pressed="${freeFilter===pc}">${nn(pc)}</button>`).join('');$('#show-names').setAttribute('aria-pressed',String(showNames));$('#show-names').textContent=showNames?'音名を隠す':'音名を見せる';}
function showSettings(){pickedRoot=prefs.root;$('#sound-enabled').checked=prefs.sound;renderRootChoices();$('#settings-dialog').showModal();}
function renderRootChoices(){$('#root-grid').innerHTML=ROOTS.map(pc=>`<button type="button" class="root-choice ${pickedRoot===pc?'active':''}" data-root="${pc}" aria-pressed="${pickedRoot===pc}">${nn(pc)}</button>`).join('');}
function showHistory(){
  if(journey.phase==='recall'&&history.some(r=>r.root===journey.rootPc)&&!recallPeeked){recallPeeked=true;journey.hints++;}
  $('#route-history').innerHTML=history.length?[...history].reverse().map((r,index)=>`<div class="history-row"><span class="history-note">${nn(r.root)}</span><div class="history-info"><strong>${r.route.map(p=>p.fret).join(' — ')}</strong><span>6弦から1弦 / ${new Date(r.at).toLocaleDateString('ja-JP')}<br>一度で再現 ${r.clean}/5 ・ 道しるべ ${r.hints}回</span></div><button class="history-play" data-history="${history.length-index-1}" aria-label="${nn(r.root)}の道を聴く">▶</button></div>`).join(''):'<div class="history-empty"><span>↗</span><h3>最初の一本は、ここから。</h3><p>音をつなぎ、地図を消し、別の音へ。<br>3つのステップを終えると、道あとが残ります。</p></div>';
  $('#history-dialog').showModal();
}
$('#board-scroll').addEventListener('click',e=>{const el=e.target.closest('[data-position]');if(!el)return;const [s,f]=el.dataset.position.split('-').map(Number);choosePosition(makePosition(s,f));});
$('#board-scroll').addEventListener('keydown',e=>{
  const el=e.target.closest('[data-position]');if(!el)return;
  if(e.key==='Enter'||e.key===' '){e.preventDefault();const [s,f]=el.dataset.position.split('-').map(Number);choosePosition(makePosition(s,f));return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();let [s,f]=el.dataset.position.split('-').map(Number);
  if(e.key==='ArrowLeft')f=Math.max(0,f-1);if(e.key==='ArrowRight')f=Math.min(12,f+1);if(free){if(e.key==='ArrowUp')s=Math.max(1,s-1);if(e.key==='ArrowDown')s=Math.min(6,s+1);}
  const next=$(`#board-scroll [data-position="${s}-${f}"]`);if(next){el.setAttribute('tabindex','-1');next.setAttribute('tabindex','0');next.focus({preventScroll:true});next.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}
});
$('#name-entry').addEventListener('submit',e=>{e.preventDefault();submitName($('#note-input').value);});
$('#continue-button').addEventListener('click',advancePhase);$('#hint-button').addEventListener('click',hint);
$('#listen-button').addEventListener('click',()=>{if(journey.phase==='ear'&&!free)playPath(phrase,{show:false});else playPath([activeTask()?.position||lastTouched||activePath().at(-1)]);});
$('#route-play').addEventListener('click',()=>playPath(free?journey.route:activePath()));
$('#free-toggle').addEventListener('click',()=>{stopPlayback();if(!free&&journey.phase==='recall'&&!recallPeeked){recallPeeked=true;journey.hints++;}if(!free&&journey.phase==='transfer'&&!journey.currentAssisted){journey.currentAssisted=true;journey.hints++;}if(!free&&journey.phase==='ear')phraseHint=true;free=!free;feedback=null;wrong=null;render();if(free)requestAnimationFrame(()=>centerOn(lastTouched));});
$('#pitch-filters').addEventListener('click',e=>{const b=e.target.closest('[data-pc]');if(!b)return;freeFilter=b.dataset.pc==='all'?null:Number(b.dataset.pc);render();});
$('#show-names').addEventListener('click',()=>{showNames=!showNames;render();});
$('#settings-open').addEventListener('click',showSettings);$('#root-open').addEventListener('click',showSettings);
$('#root-grid').addEventListener('click',e=>{const b=e.target.closest('[data-root]');if(!b)return;pickedRoot=Number(b.dataset.root);renderRootChoices();});
$('#settings-form').addEventListener('submit',e=>{if(e.submitter?.value!=='save')return;const changed=pickedRoot!==prefs.root;prefs.sound=$('#sound-enabled').checked;if(journey.phase==='ear'&&!prefs.sound)phraseHint=true;stopPlayback();save();if(changed)fresh(pickedRoot);else render();});
$('#archive-open').addEventListener('click',showHistory);$('#history-close').addEventListener('click',()=>{$('#history-dialog').close();stopPlayback();});
$('#route-history').addEventListener('click',e=>{const b=e.target.closest('[data-history]');if(b)playPath(history[Number(b.dataset.history)].route,{show:false});});
$('#pad-toggle').addEventListener('click',()=>{padVisible=!padVisible;render();});
$('#note-pad').innerHTML=Array.from({length:12},(_,pc)=>`<button class="note-choice" data-note="${pc}">${nn(pc)}</button>`).join('');
$('#note-pad').addEventListener('click',e=>{const b=e.target.closest('[data-note]');if(b)submitName(nn(Number(b.dataset.note)));});
$('#next-root').addEventListener('click',()=>{const next=ROOTS[(ROOTS.indexOf(journey.rootPc)+1)%ROOTS.length];fresh(next);$('#studio').scrollIntoView({block:'start',behavior:'instant'});});
$('#replay-journey').addEventListener('click',()=>{fresh(journey.rootPc);$('#studio').scrollIntoView({block:'start',behavior:'instant'});});$('#ear-start').addEventListener('click',startEar);
for(const d of $$('.dialog'))d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();});
document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.repeat||e.metaKey||e.ctrlKey||e.altKey||$$('dialog[open]').length||['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(e.target.tagName)||e.target.closest('[role="button"]'))return;if(e.key===' '){e.preventDefault();$('#listen-button').click();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlayback();});
window.addEventListener('resize',()=>requestAnimationFrame(()=>{renderBoard();centerOn(activeTask()?.position||lastTouched);}));
render();save();requestAnimationFrame(()=>centerOn(lastTouched));

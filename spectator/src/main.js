import './style.css';
import { RaceScene } from './scene.js';
import { createDemo } from './demo.js';
import { PoseBuffer, LiveFeed, raceKey, relaySocketUrl } from './telemetry.js';
import { validMessage, frameMatchesManifest } from '../shared/protocol.mjs';
import { isOnboard } from './onboard.js';
import { driverName } from './broadcast.js';
import { BroadcastUI } from './broadcast-ui.js';
import { SOURCES, sourceFromSearch } from '../shared/sources.mjs';

const $=id=>document.getElementById(id),buffer=new PoseBuffer();let scene,manifest,demo,feed,preview=true,lastDemo=-1,night=false,lastUi=0,connectionState='connecting';
let source=sourceFromSearch(location.search),connectionGeneration=0,relayAddress='';
const sourceLabel=()=>SOURCES[source].label;
const broadcast=new BroadcastUI(selectDriver);let names=true,effects=!matchMedia('(prefers-reduced-motion: reduce)').matches;
const fail=message=>{$('error').textContent=message;$('error').hidden=false;};
try{scene=new RaceScene($('scene'));scene.onError=fail;scene.onFreeLook=()=>{$('follow').value='-1';};}catch(e){fail('3D rendering could not start. Try a browser with WebGL 2 and hardware acceleration enabled. '+e.message);}
if(scene){scene.onSelectDriver=selectDriver;scene.setEffects(effects);}
function selectDriver(id){if(!manifest?.roster.some(r=>r.id===id&&!r.safety))return;$('tv-driver').value=String(id);$('tv-coverage').value='driver';if(['auto','aerial','trackside'].includes($('tv-angle').value))$('tv-angle').value='chase';selectMode('tv');}

function status(state){connectionState=state;const name=sourceLabel().toUpperCase(),labels={connecting:'CONNECTING',waiting:`WAITING FOR ${name}`,offline:`${name} OFFLINE`,reconnecting:'RECONNECTING',invalid:'INVALID RACE DATA',live:`LIVE FROM ${name}`,stale:'SIGNAL INTERRUPTED',preview:'OFFLINE PREVIEW'};$('status-text').textContent=labels[state]||state;$('connection').className=`status ${state==='live'?'live':state==='preview'?'':'stale'}`;}
function showSource(){
  for(const key of Object.keys(SOURCES)){const tab=$(`source-${key}`),selected=source===key;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
  $('race-content').setAttribute('aria-labelledby',`source-${source}`);
  $('connect-description').textContent=`Connect to your race relay to watch ${sourceLabel()} live. Camera choices stay yours.`;
}
function resetRace(){
  connectionGeneration++;feed?.close();feed=null;manifest=null;demo=null;buffer.reset();broadcast.reset();scene?.reset();lastUi=0;
  $('scene').hidden=true;$('app').classList.add('awaiting-race');$('waiting-feed').hidden=false;
  $('waiting-title').textContent=`Waiting for ${sourceLabel()}`;
  $('waiting-detail').textContent=source==='pi'?'Your Pi race will appear here when its publisher is connected. This feed is separate from ESP32.':'Your live race will appear here when the ESP32 publishes to the relay.';
  $('track-name').textContent=sourceLabel();$('standings').replaceChildren();$('stand').replaceChildren();$('follow').replaceChildren(new Option('The circuit','-1'));$('tv-driver').replaceChildren();
  $('lap').textContent='WAITING';$('weather').textContent='';$('race-event').textContent='';$('tv-shot').textContent='Waiting for race data';if(scene)$('error').hidden=true;
}
function showRace(){$('scene').hidden=false;$('waiting-feed').hidden=true;$('app').classList.remove('awaiting-race');}
function load(m){if(!validMessage(m))throw new Error('The race description is invalid or uses an unsupported protocol.');const same=manifest&&raceKey(manifest)===raceKey(m),previousMode=scene?.mode,hadRace=!!manifest,previousDriverCode=manifest?.roster.find(r=>r.id===Number($('tv-driver').value))?.code;manifest=m;if(same)return;
  buffer.reset(raceKey(m));broadcast.reset();scene?.load(m);$('track-name').textContent=m.track.name;$('stand').replaceChildren();
  m.track.stands.forEach((st,i)=>{const o=new Option(st.name||`${String(i+1).padStart(2,'0')} · ${i===0?'Main grandstand':'Corner grandstand'}`,i);$('stand').add(o);});
  $('stands-mode').disabled=!m.track.stands.length;$('row').value='1';$('follow').replaceChildren(new Option('The circuit','-1'));m.roster.filter(r=>!r.safety).forEach(r=>$('follow').add(new Option(`${r.code} · #${r.num}`,r.id)));
  $('tv-driver').replaceChildren();m.roster.filter(r=>!r.safety).forEach(r=>$('tv-driver').add(new Option(`${r.code} · #${r.num}`,r.id)));const previousDriver=m.roster.find(r=>!r.safety&&r.code===previousDriverCode);if(previousDriver)$('tv-driver').value=String(previousDriver.id);
  $('standings').replaceChildren();for(const r of m.roster.filter(r=>!r.safety)){const el=document.createElement('button');el.type='button';el.className='driver';el.dataset.id=r.id;el.innerHTML='<span class="position"></span><span class="livery"></span><span class="code"></span><span class="gap"></span>';el.onclick=()=>selectDriver(Number(el.dataset.id));$('standings').append(el);}
  selectMode(hadRace&&previousMode==='tv'?'tv':m.track.stands.length?'stands':'overview');
}
function selectMode(mode){scene?.selectMode(mode);for(const id of ['stands','tv','overview']){const button=$(id+'-mode');button.classList.toggle('active',mode===id);button.setAttribute('aria-pressed',String(mode===id));}$('seat-controls').hidden=mode!=='stands';$('tv-controls').hidden=mode!=='tv';$('app').classList.toggle('tv-view',mode==='tv');$('view-title').textContent=mode==='stands'?'Trackside, together.':mode==='tv'?'Stay with the action.':'The whole story.';$('view-description').textContent=mode==='stands'?'Drag to look around · Scroll to zoom':mode==='tv'?'Choose your coverage · Scroll to zoom':'Drag to orbit · Scroll to zoom';$('view-kicker').textContent=mode==='stands'?'THE BEST SEAT IS YOURS':mode==='tv'?'LIVE RACE COVERAGE':'EVERY CORNER. EVERY CAR.';$('follow').value='-1';if(mode==='tv')configureTV();seatLabel();}
function configureTV(){let mode=$('tv-coverage').value;const onboard=isOnboard($('tv-angle').value);if(onboard&&!['leader','driver'].includes(mode)){mode='driver';$('tv-coverage').value=mode;}$('tv-driver-field').hidden=mode!=='driver';$('tv-next').hidden=mode!=='auto';$('tv-orbit-hint').hidden=!['leader','driver'].includes(mode);$('tv-orbit-hint').textContent=onboard?'Drag to look around · Reset view looks straight ahead':'Drag to orbit the car · Scroll to move closer. Reset view restores the camera angle.';scene?.setTV(mode,Number($('tv-driver').value),$('tv-angle').value);$('tv-shot').textContent='Finding the action…';}
function seatLabel(){$('seat-label').textContent=scene?.mode==='stands'?`Stand ${Number($('stand').value)+1} · ${['Front','Middle','Back'][Number($('row').value)]} row`:scene?.mode==='tv'?'Your independent TV feed':'Circuit overview';}
function startPreview(){resetRace();preview=true;demo=createDemo(Number($('preview-vehicle').value));demo.setNight(night);demo.setConditions(Number($('preview-weather').value),Number($('preview-phase').value));load(demo.manifest);showRace();lastDemo=-1;status('preview');$('night-toggle').hidden=false;$('source-label').textContent='OFFLINE PREVIEW · Illustrative motion, not a live race feed';$('connect-dialog').close();const url=new URL(location.href);url.searchParams.delete('relay');history.replaceState(null,'',url);}
function connect(address){
  resetRace();preview=false;$('night-toggle').hidden=true;$('source-label').textContent=`${sourceLabel().toUpperCase()} · Waiting for authoritative race data`;
  try{relaySocketUrl(address,location.protocol==='https:',source);}catch(e){status('invalid');fail(e.message);$('connect-error').textContent=e.message;return;}
  const generation=connectionGeneration;relayAddress=address;$('connect-error').textContent='';$('connect-dialog').close();
  const url=new URL(location.href);url.searchParams.set('relay',address);history.replaceState(null,'',url);try{localStorage.setItem('race-relay',address);}catch{}
  feed=new LiveFeed(address,{status:s=>{if(generation===connectionGeneration)status(s);},message:m=>{if(generation!==connectionGeneration)return;try{if(m.type==='manifest'){load(m);$('source-label').textContent=`${sourceLabel().toUpperCase()} · Live race · Independent spectator camera`;}else if(validMessage(m)&&manifest&&frameMatchesManifest(m,manifest)&&buffer.push(m,performance.now())){showRace();status('live');}}catch(e){status('invalid');fail(e.message);}}},source);
}
function selectSource(key){
  if(key===source)return;source=key;showSource();
  const url=new URL(location.href);url.searchParams.set('source',source);history.replaceState(null,'',url);
  connect(relayAddress||$('relay-url').value);
}
const sourceKeys=Object.keys(SOURCES);
sourceKeys.forEach((key,i)=>{const tab=$(`source-${key}`);tab.onclick=()=>selectSource(key);tab.onkeydown=e=>{let next;if(e.key==='ArrowRight')next=(i+1)%sourceKeys.length;else if(e.key==='ArrowLeft')next=(i+sourceKeys.length-1)%sourceKeys.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=sourceKeys.length-1;else return;e.preventDefault();$(`source-${sourceKeys[next]}`).focus();selectSource(sourceKeys[next]);};});
function updateUI(frame){if(!manifest||!frame)return;const roster=new Map(manifest.roster.map(r=>[r.id,r]));const poses=new Map(frame.cars.map(c=>[c[0],c]));const rows=[...$('standings').children];
  rows.forEach(el=>el.hidden=true);
  frame.order.slice(0,rows.length).forEach((id,i)=>{const el=rows[i],r=roster.get(id),p=poses.get(id);if(!r||!p)return;el.hidden=false;el.dataset.id=id;el.setAttribute('aria-label',`Follow ${driverName(r)}, position ${i+1}`);el.setAttribute('aria-pressed',String(scene?.mode==='tv'&&scene.tvShot?.ids[0]===id));el.querySelector('.position').textContent=String(i+1).padStart(2,'0');el.querySelector('.livery').style.background='#'+r.colors[0].toString(16).padStart(6,'0');el.querySelector('.code').textContent=r.code;el.querySelector('.gap').textContent=frame.phase===0?'GRID':p[7]?'OUT':p[6]>0?'PIT':p[11]?'FINISHED':i===0?'LEADER':p[12]<0?`${Math.abs(Math.round(p[12]))} LAP`:`+${p[12].toFixed(1)}`;});
  $('lap').textContent=preview?'PREVIEW':frame.phase===0?'ON THE GRID':frame.phase===3?'RESULTS':frame.phase===2?'CHEQUERED':`LAP ${frame.lap}${frame.laps?' / '+frame.laps:''}`;
  $('weather').textContent=`${frame.night>.5?'NIGHT · ':''}${['CLEAR SKIES','PARTLY CLOUDY','OVERCAST','RAIN','STORM','SNOW','FOG'][frame.weather]||'CLEAR'}`;
  $('race-event').textContent=frame.event||(frame.phase===0?'The grid is forming.':frame.phase===3?'Race complete. Next circuit follows.':`${frame.series} · ${frame.order.length} drivers`);
  if(scene?.mode==='tv'&&scene.tvShot){const label=scene.tvShot.label;if($('tv-shot').textContent!==label)$('tv-shot').textContent=label;}
  broadcast.update(frame,manifest,scene?.mode==='tv'&&scene.tvShot?.ids.length===1?scene.tvShot.ids[0]:-1,preview,scene?.isOnboard(),effects);
}
$('stands-mode').onclick=()=>selectMode('stands');$('overview-mode').onclick=()=>selectMode('overview');$('tv-mode').onclick=()=>selectMode('tv');
for(const id of ['tv-driver','tv-angle'])$(id).onchange=configureTV;
$('tv-coverage').onchange=()=>{if(!['leader','driver'].includes($('tv-coverage').value)&&isOnboard($('tv-angle').value))$('tv-angle').value='auto';configureTV();};
$('tv-next').onclick=()=>scene?.nextTV();
for(const id of ['stand','row'])$(id).onchange=()=>{scene?.setSeat(Number($('stand').value),Number($('row').value));$('follow').value='-1';seatLabel();};
$('follow').onchange=()=>{if(scene){scene.follow=Number($('follow').value);scene.yaw=0;scene.pitch=0;}};
$('reset-view').onclick=()=>{scene?.resetView();$('follow').value='-1';};
$('connection').onclick=()=>{$('connect-error').textContent='';$('connect-dialog').showModal();};$('close-dialog').onclick=()=>$('connect-dialog').close();
$('connect-form').onsubmit=e=>{e.preventDefault();connect($('relay-url').value.trim());};$('preview-button').onclick=startPreview;
$('night-toggle').onclick=()=>{night=!night;demo?.setNight(night);$('night-toggle').textContent=night?'◐ Daylight':'◐ Evening';};
$('names-toggle').onclick=()=>{names=!names;scene?.setNames(names);$('names-toggle').setAttribute('aria-pressed',String(names));$('names-toggle').textContent=names?'Names on':'Names off';};
const showEffects=()=>{$('effects-toggle').setAttribute('aria-pressed',String(effects));$('effects-toggle').textContent=effects?'Effects on':'Effects off';};showEffects();
$('effects-toggle').onclick=()=>{effects=!effects;scene?.setEffects(effects);showEffects();};
$('hud-toggle').onclick=()=>{$('app').classList.add('hud-hidden');$('show-hud').hidden=false;};$('show-hud').onclick=()=>{$('app').classList.remove('hud-hidden');$('show-hud').hidden=true;};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{fail('Full screen is unavailable in this browser window.');}};
const params=new URLSearchParams(location.search),configured=params.get('relay')||(location.hostname==='race.ayxie.com'?location.origin:null);
try{$('relay-url').value=configured||localStorage.getItem('race-relay')||'https://race.ayxie.com';}catch{$('relay-url').value='https://race.ayxie.com';}
showSource();if(configured||source==='pi')connect(configured||$('relay-url').value);else startPreview();
function tick(now){if(preview){const seq=Math.floor(now/100);if(seq!==lastDemo){lastDemo=seq;buffer.push(demo.frame(seq/10),now);}}else if(buffer.frames.length&&buffer.stale(now)&&connectionState==='live')status('stale');
  const frame=buffer.sample(now);scene?.update(frame);scene?.render();if(now-lastUi>200){updateUI(frame);lastUi=now;}requestAnimationFrame(tick);}
requestAnimationFrame(tick);
window.addEventListener('pagehide',()=>feed?.close());
window.addEventListener('pageshow',e=>{if(e.persisted&&!preview&&relayAddress)connect(relayAddress);});

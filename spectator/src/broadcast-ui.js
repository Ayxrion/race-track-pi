import {broadcastState} from './broadcast.js';
import {weatherIntensity} from './weather-effects.js';

export class BroadcastUI {
  constructor(selectDriver){
    this.selectDriver=selectDriver;this.$=id=>document.getElementById(id);
    this.$('classification-close').onclick=()=>{this.dismissed=this.phaseKey;this.$('classification').hidden=true;};
    this.$('classification-open').onclick=()=>{this.dismissed=null;this.$('classification').hidden=false;};
    this.drops=Array.from({length:18},(_,i)=>{const drop=document.createElement('i');drop.className='lens-drop';drop.style.left=`${(i*61.8)%100}%`;drop.style.width=`${3+i%5}px`;drop.style.height=`${9+i%7}px`;this.$('lens-weather').append(drop);return drop;});
  }
  reset(){this.dismissed=null;this.signature=null;this.phaseKey=null;for(const id of ['classification','driver-card','broadcast-strip','lens-weather'])this.$(id).hidden=true;}
  update(frame,manifest,selected,preview,onboard,effects){
    const state=broadcastState(frame,manifest,selected),key=`${manifest.session}/${manifest.race}/${frame.phase}`;
    this.$('broadcast-strip').hidden=false;
    this.phaseKey=key;this.$('broadcast-phase').textContent=(preview?'PREVIEW · ':'')+state.phase;
    this.$('broadcast-lap').textContent=frame.phase===0?`${state.rows.length} DRIVERS`:state.lap;
    this.$('broadcast-headline').textContent=state.headline;
    if(this.$('broadcast-event').textContent!==state.event)this.$('broadcast-event').textContent=state.event||'';this.$('broadcast-event').hidden=!state.event;
    this.$('broadcast-strip').dataset.phase=frame.phase;
    this.$('driver-card').hidden=!state.driver;
    if(state.driver){const d=state.driver;this.$('driver-card-name').textContent=d.name;this.$('driver-card-number').textContent=`#${d.number}`;this.$('driver-card-position').textContent=`P${d.position} · ${d.status}`;this.$('driver-card-view').textContent=onboard?'ONBOARD':'FOLLOWING';}
    this.$('classification').hidden=!state.classification||this.dismissed===key;
    this.$('classification-open').hidden=!state.classification;this.$('classification-open').textContent=frame.phase===0?'View starting grid →':'View results →';
    if(state.classification){
      this.$('classification-title').textContent=state.phase;
      this.$('classification-track').textContent=manifest.track.name;
      const signature=JSON.stringify([key,state.rows]);
      if(signature!==this.signature){this.signature=signature;this.$('classification-rows').replaceChildren();for(const r of state.rows){const button=document.createElement('button');button.type='button';button.className='classification-row';const position=document.createElement('span'),name=document.createElement('strong'),status=document.createElement('span');position.textContent=String(r.position).padStart(2,'0');name.textContent=`${r.name} · #${r.number}`;status.textContent=frame.phase===0?'On the grid':r.status;button.append(position,name,status);button.onclick=()=>{this.selectDriver(r.id);this.dismissed=key;this.$('classification').hidden=true;};this.$('classification-rows').append(button);}}
    }
    const rain=effects&&onboard&&(frame.weather===3||frame.weather===4);this.$('lens-weather').hidden=!rain;
    if(rain)for(let i=0;i<this.drops.length;i++){this.drops[i].style.top=`${((i*17.3+frame.t*(2+i%3))%120)-10}%`;this.drops[i].style.opacity=String(weatherIntensity(frame.weather)*.65);}
  }
}

const distance=(a,b)=>Math.hypot(a[1]-b[1],a[2]-b[2]);
const active=p=>p&&!p[7]&&!p[11]&&p[6]===0;

// Project onto the actual circuit, using heading to disambiguate crossings.
export function trackProgress(p,track){
  let best=Infinity,s=0;
  for(let i=0;i<track.points.length;i++){
    const a=track.points[i],b=track.points[(i+1)%track.points.length],dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
    const u=length2?Math.max(0,Math.min(1,((p[1]-a[0])*dx+(p[2]-a[1])*dz)/length2)):0;
    const alignment=length2?(Math.cos(p[3])*dx+Math.sin(p[3])*dz)/Math.sqrt(length2):0;
    const score=(p[1]-a[0]-u*dx)**2+(p[2]-a[1]-u*dz)**2+(1-alignment)*track.width**2*.2;
    if(score<best){best=score;s=(i+u)*track.ds;}
  }
  return p[5]*track.L+s;
}

export function findBattle(frame,track){
  const poses=new Map(frame.cars.map(p=>[p[0],p])),progress=new Map();
  const at=p=>{if(!progress.has(p[0]))progress.set(p[0],trackProgress(p,track));return progress.get(p[0]);};
  let best=null;
  for(let k=1;k<frame.order.length;k++){
    const front=poses.get(frame.order[k-1]),chaser=poses.get(frame.order[k]);
    if(!active(front)||!active(chaser)||distance(front,chaser)>80)continue;
    const gap=at(front)-at(chaser),score=gap+k*1.5;
    if(gap>0&&gap<=45&&(!best||score<best.score))best={ids:[chaser[0],front[0]],gap,score};
  }
  return best;
}

export class TVDirector {
  constructor(manifest){this.manifest=manifest;this.mode='auto';this.driver=manifest.roster.find(r=>!r.safety)?.id??-1;this.angle='auto';this.reset();}
  reset(){this.shot=null;this.lastTime=null;this.until=-Infinity;this.nextBattleAt=-Infinity;this.battle=null;this.sequence=0;this.driverCursor=0;this.phase=null;}
  configure(mode,driver=this.driver,angle=this.angle){this.mode=mode;this.driver=driver;this.angle=angle;this.reset();}
  next(){this.until=-Infinity;this.nextBattleAt=-Infinity;}
  update(frame){
    const t=frame.t;
    if(this.lastTime!==null&&(t<this.lastTime||t-this.lastTime>2.5))this.reset();
    this.lastTime=t;
    const poses=new Map(frame.cars.map(p=>[p[0],p]));
    const leader=frame.order.find(id=>poses.has(id)&&!poses.get(id)[7])??frame.order.find(id=>poses.has(id));
    if(t>=this.nextBattleAt){this.battle=findBattle(frame,this.manifest.track);this.nextBattleAt=t+.5;}
    const eligible=frame.order.filter(id=>active(poses.get(id)));
    let kind=this.mode,ids=[],notice='';
    if(this.mode==='driver'){
      if(poses.has(this.driver)){ids=[this.driver];notice=poses.get(this.driver)[7]?' · Retired':poses.get(this.driver)[11]?' · Finished':'';}
      else {ids=leader===undefined?[]:[leader];notice=' · Selected driver unavailable';}
    }else if(this.mode==='leader')ids=leader===undefined?[]:[leader];
    else{
      const invalid=this.shot?.ids.some(id=>!poses.has(id)||poses.get(id)[7]||(frame.phase===1&&['battle','driver'].includes(this.shot.kind)&&!active(poses.get(id))));
      const split=this.shot?.kind==='battle'&&this.shot.ids.length===2&&poses.has(this.shot.ids[0])&&poses.has(this.shot.ids[1])&&distance(poses.get(this.shot.ids[0]),poses.get(this.shot.ids[1]))>80;
      if(!this.shot||t>=this.until||invalid||split||frame.phase!==this.phase){
        const beat=this.sequence++;
        let angle='chase';
        if(this.mode==='battle')kind='battle';
        else if(frame.phase===0)kind='grid';
        else if(frame.phase===3)kind='overview';
        else if(frame.phase===2)kind='leader';
        else kind=['leader','battle','driver','overview','battle','leader'][beat%6];
        if(kind==='battle'){
          ids=this.battle?.ids??(leader===undefined?[]:[leader]);
          if(ids.length<2){kind='leader';notice=' · No close battle';}
          angle='aerial';
        }else if(kind==='driver'){
          const alternatives=eligible.filter(id=>id!==this.shot?.ids[0]&&id!==leader),pool=alternatives.length?alternatives:eligible;
          const id=pool[this.driverCursor++%Math.max(1,pool.length)]??leader;ids=id===undefined?[]:[id];angle='trackside';
        }else if(kind==='grid')ids=frame.order.filter(id=>poses.has(id));
        else if(kind!=='overview')ids=leader===undefined?[]:[leader];
        if(kind==='leader'&&beat%2)angle='aerial';
        this.shot={kind,ids,angle,notice,serial:beat};this.until=t+(this.mode==='battle'?6:kind==='overview'?6:12);
      }
      ({kind,ids,notice}=this.shot);
      // Follow changes of race leader immediately, even during a held shot.
      if(kind==='leader')ids=leader===undefined?[]:[leader];
    }
    this.phase=frame.phase;
    const angle=this.angle==='auto'?(this.shot?.angle??'chase'):this.angle;
    const names=ids.slice(0,2).map(id=>{const r=this.manifest.roster.find(r=>r.id===id);return r?`${r.code} #${r.num??id+1}`:`Car ${id+1}`;});
    const label=({auto:'TV Director',leader:'Leader',battle:'Closest battle',driver:'Following',grid:'Starting grid',overview:'Circuit overview'})[kind];
    return {kind,ids,angle,key:`${kind}/${ids.join(',')}/${angle}/${this.shot?.serial??0}`,label:`${label}${kind==='overview'||kind==='grid'?'':names.length?' · '+names.join(' / '):' · Waiting for cars'}${notice}`};
  }
}

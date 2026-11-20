const finite = (v, max=10000000) => typeof v==='number' && Number.isFinite(v) && Math.abs(v)<=max;
const integer = (v,max=10000000) => Number.isInteger(v)&&v>=0&&v<=max;
const text = (v,n) => typeof v==='string'&&v.length<=n;
export function validMessage(m) {
  if(!m||m.v!==1||!text(m.session,64)||!m.session||!integer(m.race)||!['manifest','frame'].includes(m.type))return false;
  if(m.type==='manifest'){
    const t=m.track;
    if(!t||!text(t.name,80)||!finite(t.width,100)||t.width<=0||!finite(t.L)||t.L<=0||!finite(t.ds)||t.ds<=0)return false;
    if(!Array.isArray(t.points)||t.points.length<3||t.points.length>2048||Math.abs(t.ds*t.points.length-t.L)>Math.max(2,t.L*.005))return false;
    if(!t.points.every(p=>Array.isArray(p)&&p.length===10&&p.every(v=>finite(v,100000))))return false;
    if(!Array.isArray(t.stands)||t.stands.length>10||!t.stands.every(s=>s&&['sc','half','d0','d1'].every(k=>finite(s[k]))&&s.half>0&&s.half<400&&s.d0>0&&s.d1>s.d0&&s.d1-s.d0<100&&[0,1].includes(s.side)))return false;
    if(t.lights!==undefined&&(!Array.isArray(t.lights)||t.lights.length>40||!t.lights.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>finite(v,100000)))))return false;
    if(t.pits&&(![-1,1].includes(t.pits.side)||typeof t.pits.has!=='boolean'||!finite(t.pits.s0)||!finite(t.pits.s1)||t.pits.s1-t.pits.s0>1000))return false;
    if(!Array.isArray(m.roster)||m.roster.length<1||m.roster.length>21)return false;
    const ids=new Set();return m.roster.every(r=>{if(!r||!integer(r.id,20)||ids.has(r.id)||!text(r.code,12)||!integer(r.cls,7)||!finite(r.len,30)||r.len<1||!finite(r.wid,15)||r.wid<1||!Array.isArray(r.colors)||r.colors.length!==3||!r.colors.every(c=>integer(c,0xffffff)))return false;ids.add(r.id);return true;});
  }
  if(!integer(m.seq,Number.MAX_SAFE_INTEGER)||!finite(m.t,1e10)||m.t<0||!integer(m.phase,3)||!integer(m.lap,100000)||!integer(m.laps,100000)||!integer(m.weather,7)||!finite(m.night,1)||m.night<0||!finite(m.wet,1)||m.wet<0||!text(m.event,120)||!text(m.series,24))return false;
  if(!Array.isArray(m.order)||m.order.length>20||!m.order.every(i=>integer(i,20))||new Set(m.order).size!==m.order.length)return false;
  if(!Array.isArray(m.cars)||m.cars.length>21||m.cars.length<1)return false;
  const ids=new Set();return m.cars.every(c=>{if(!Array.isArray(c)||c.length!==13||!integer(c[0],20)||ids.has(c[0])||![1,2,3,4,5,6,9,12].every(i=>finite(c[i]))||![7,8,10,11].every(i=>typeof c[i]==='boolean'))return false;ids.add(c[0]);return true;});
}

export function frameMatchesManifest(frame, manifest) {
  const ids=new Set(manifest.roster.map(r=>r.id));
  return frame.session===manifest.session&&frame.race===manifest.race&&frame.cars.every(c=>ids.has(c[0]))&&frame.order.every(id=>ids.has(id)&&frame.cars.some(c=>c[0]===id));
}

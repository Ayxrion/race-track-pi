import { CatmullRomCurve3, Vector3 } from 'three';
import outline from './monza.json';

// Preview only: original repository's Monza outline, fitted independently.
// Live mode always uses the ESP32's final sampled geometry and car poses.
export function createDemo(cls=0) {
  const spec=cls===6?{len:8.5,wid:3.2,series:'Motorcycles'}:cls===7?{len:7,wid:5,series:'Karts'}:{len:14,wid:5.8,series:'Formula'};
  const curve = new CatmullRomCurve3(outline.map(([x,y]) => new Vector3(400+x*.36,0,80+y*.36)), true, 'centripetal');
  const n = 720, L = curve.getLength(), ds = L/n;
  const points = Array.from({length:n}, (_,i) => { const p=curve.getPointAt(i/n), t=curve.getTangentAt(i/n); return [p.x,p.z,t.x,t.z,32,32,i%100<32?1:0,i%100>=65?1:0,1,1]; });
  const colors = [0xd63932,0x2164c5,0x0d8a75,0xef8b24,0xe9e4ca,0x9854bd,0xf0c737];
  const codes = ['ARD','BEL','CRN','DAV','EKS','FON','GUL','HAR','IST','JOV','KAR','LIN','MOT','NYG'];
  const roster = codes.map((code,id) => ({id,code,num:id+1,cls,len:spec.len,wid:spec.wid,colors:[colors[Math.floor(id/2)],0xf1f1e8,0x263237]}));
  const stands = [{sc:45,half:66,d0:40,d1:64,side:0,roofHue:1,name:'01 · Main straight'},{sc:L*.43,half:48,d0:43,d1:63,side:0,roofHue:4,name:'02 · Lesmo view'},{sc:L*.86,half:48,d0:43,d1:63,side:0,roofHue:0,name:'03 · Parabolica'}];
  const manifest = {v:1,type:'manifest',session:'offline-preview',race:1,track:{name:'Monza',place:'ITALY',width:24,L,ds,points,stands,pits:{has:true,side:1,s0:-85,s1:130},lights:[]},roster};
  let night=false,weather=0,phase=1;
  return {manifest,setNight(v){night=v;},setConditions(w,p){weather=w;phase=p;},frame(t){
    const cars=roster.map((r,i)=>{const s=phase===0?(L-12-i*17)%L:(t*82-i*L/roster.length+L*10)%L,fi=s/ds,j=Math.floor(fi)%n,u=fi-j,a=points[j],b=points[(j+1)%n],d=phase===0?(i%2?3:-3):Math.sin(i*2+t*.15)*3;
      return [i,a[0]+(b[0]-a[0])*u-a[3]*d,a[1]+(b[1]-a[1])*u+a[2]*d,Math.atan2(a[3],a[2]),phase===0?0:82,Math.max(0,Math.floor((t*82-i*22)/L)),0,false,false,0,false,phase>=2,i*.27]; });
    return {v:1,type:'frame',session:manifest.session,race:1,seq:Math.floor(t*10),t,phase,lap:phase===0?0:Math.floor(t*82/L)+1,laps:0,series:spec.series,weather,night:night?.88:0,wet:weather===3?.7:weather===4?1:weather===5?.25:0,event:'Offline preview · Illustrative car motion',order:roster.map(r=>r.id),cars};
  }};
}

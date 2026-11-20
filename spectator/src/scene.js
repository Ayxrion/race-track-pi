import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createCar, animateCar } from './models.js';
import { updateVehicleLights } from './car-lights.js';
import { TVDirector } from './director.js';
import { TVCamera } from './tv-camera.js';
import { isOnboard, updateOnboard } from './onboard.js';
import { DriverLabels } from './driver-labels.js';
import { WeatherEffects } from './weather-effects.js';
import { Atmosphere } from './atmosphere.js';

const v3 = (x,y,z) => new THREE.Vector3(x,y,z);
const clamp = THREE.MathUtils.clamp;

class Instances {
  constructor(group) { this.group=group; this.pools=new Map(); this.dummy=new THREE.Object3D(); }
  add(kind,color,x,y,z,sx,sy,sz,yaw=0) {
    const key=kind; if(!this.pools.has(key))this.pools.set(key,[]);
    this.pools.get(key).push({color,x,y,z,sx,sy,sz,yaw});
  }
  segment(color,from,to,width) {
    const a=v3(...from),b=v3(...to),delta=b.clone().sub(a),length=delta.length();
    const matrix=new THREE.Matrix4().compose(a.add(b).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(v3(0,1,0),delta.normalize()),v3(width,length,width));
    if(!this.pools.has('limb'))this.pools.set('limb',[]);
    this.pools.get('limb').push({color,matrix});
  }
  finish() {
    for(const [kind,items] of this.pools) {
      const geometry=kind==='head'?new THREE.SphereGeometry(.5,10,8):kind==='hair'?new THREE.SphereGeometry(.51,10,5,0,Math.PI*2,0,Math.PI*.56):kind==='tree'?new THREE.ConeGeometry(.5,1,9):kind==='leaf'?new THREE.IcosahedronGeometry(.5,1):kind==='body'?new THREE.CylinderGeometry(.4,.5,1,8):kind==='limb'?new THREE.CylinderGeometry(.5,.5,1,6):kind==='seat'?new RoundedBoxGeometry(1,1,1,1,.12):new THREE.BoxGeometry(1,1,1);
      const mat=new THREE.MeshStandardMaterial({roughness:kind==='glass'?.2:.88,metalness:kind==='steel'?.35:kind==='glass'?.5:0,emissive:kind==='lamp'?0xffe3ac:0,emissiveIntensity:kind==='lamp'?1.5:0});
      const mesh=new THREE.InstancedMesh(geometry,mat,items.length);
      items.forEach((p,i)=>{if(p.matrix)mesh.setMatrixAt(i,p.matrix);else{this.dummy.position.set(p.x,p.y,p.z);this.dummy.rotation.set(0,p.yaw,0);this.dummy.scale.set(p.sx,p.sy,p.sz);this.dummy.updateMatrix();mesh.setMatrixAt(i,this.dummy.matrix);}mesh.setColorAt(i,new THREE.Color(p.color));});
      mesh.castShadow=kind!=='lamp';mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;this.group.add(mesh);
      if(kind==='lamp')this.lampMaterial=mat;
    }
  }
}

export class RaceScene {
  constructor(canvas) {
    this.canvas=canvas; this.scene=new THREE.Scene();
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.0;
    const studio=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(this.renderer);
    this.environment=pmrem.fromScene(studio,.04);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.45;
    studio.dispose();pmrem.dispose();
    this.camera=new THREE.PerspectiveCamera(60,1,.15,3200);
    this.hemi=new THREE.HemisphereLight(0xdcebf4,0x64714b,2.1);this.scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight(0xffeed2,3.0);this.sun.position.set(300,500,-100);this.sun.castShadow=true;
    this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-260,right:260,top:260,bottom:-260,near:1,far:1400});this.sun.shadow.bias=-.0003;this.sun.shadow.normalBias=.5;
    this.scene.add(this.sun,this.sun.target);
    this.orbit=new OrbitControls(this.camera,canvas);this.orbit.enabled=false;this.orbit.enableDamping=true;this.orbit.minDistance=35;this.orbit.maxDistance=1600;this.orbit.maxPolarAngle=Math.PI*.48;
    this.mode='stands';this.row=1;this.standIndex=0;this.follow=-1;this.yaw=0;this.pitch=0;this.fov=60;this.models=new Map();this.poseById=new Map();this.tvCamera=new TVCamera();
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary)return;this.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0};if(this.mode!=='stands'&&!this.canOrbitTV()&&!this.isOnboard())return;this.drag={id:e.pointerId,x:e.clientX,y:e.clientY,tv:this.canOrbitTV()};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(this.pointer?.id===e.pointerId)this.pointer.moved=Math.max(this.pointer.moved,Math.hypot(e.clientX-this.pointer.x,e.clientY-this.pointer.y));if(!this.drag||this.drag.id!==e.pointerId)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(this.drag.tv)this.tvCamera.orbitBy(dx,dy);else{this.yaw-=dx*.004;this.pitch=clamp(this.pitch+dy*.003,-.65,.65);if(this.isOnboard())this.yaw=clamp(this.yaw,-1.3,1.3);else{this.follow=-1;this.onFreeLook?.();}}this.drag.x=e.clientX;this.drag.y=e.clientY;});
    canvas.addEventListener('pointerup',e=>{if(this.pointer?.id===e.pointerId&&this.pointer.moved<6)this.pickCar(e.clientX,e.clientY);this.drag=null;this.pointer=null;});canvas.addEventListener('pointercancel',()=>{this.drag=null;this.pointer=null;});
    canvas.addEventListener('wheel',e=>{if(this.mode==='overview')return;e.preventDefault();if(this.canOrbitTV())this.tvCamera.zoomBy(e.deltaY);else this.fov=clamp(this.fov+e.deltaY*.025,30,85);},{passive:false});
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.onError?.('The 3D graphics context was interrupted. Reload this page to resume.');});
    window.addEventListener('resize',()=>this.resize());this.resize();
  }
  resize(){this.renderer.setSize(innerWidth,innerHeight,false);this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();}
  at(s,d=0){const t=this.track,n=t.points.length,f=((s%t.L+t.L)%t.L)/t.ds,i=Math.floor(f)%n,u=f-Math.floor(f),a=t.points[i],b=t.points[(i+1)%n];let tx=a[2]+(b[2]-a[2])*u,tz=a[3]+(b[3]-a[3])*u;const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;return{x:a[0]+(b[0]-a[0])*u-tz*d,z:a[1]+(b[1]-a[1])*u+tx*d,tx,tz,h:Math.atan2(tz,tx)};}
  clear(){if(!this.world)return;this.scene.remove(this.world);const geometries=new Set(),materials=new Set();this.world.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>{m.map?.dispose();m.dispose();});this.models.clear();}
  reset(){
    this.clear();this.world=null;this.track=null;this.manifest=null;this.frame=null;
    this.poseById.clear();this.rosterById=null;this.labels=null;this.weatherEffects=null;this.atmosphere=null;
    this.director=null;this.tvShot=null;this.tvCamera.reset();this.mode='stands';this.follow=-1;
    this.drag=null;this.pointer=null;this.orbit.enabled=false;this.renderer.clear();
  }
  load(manifest){
    this.clear();this.track=manifest.track;this.manifest=manifest;this.world=new THREE.Group();this.scene.add(this.world);this.instances=new Instances(this.world);
    this.rosterById=new Map(manifest.roster.map(r=>[r.id,r]));this.atmosphere=new Atmosphere(this.world);
    this.lightFixtures=[];this.lastLight=undefined;this.lightFocus=null;this.director=new TVDirector(manifest);this.tvShot=null;this.frame=null;
    const points=this.track.points,xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
    this.center=v3((Math.min(...xs)+Math.max(...xs))/2,0,(Math.min(...zs)+Math.max(...zs))/2);
    this.bounds={minX:Math.min(...xs)-260,maxX:Math.max(...xs)+260,minZ:Math.min(...zs)-260,maxZ:Math.max(...zs)+260};
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(6500,6500),new THREE.MeshStandardMaterial({color:0x718854,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.set(this.center.x,-.15,this.center.z);ground.receiveShadow=true;this.world.add(ground);
    const hw=this.track.width/2;
    this.roadMat=new THREE.MeshStandardMaterial({color:0x454d4c,roughness:.95,side:THREE.DoubleSide});
    this.ribbon(-hw,hw,.02,this.roadMat);
    this.ribbon(-hw-.5,-hw+.2,.07,0xd4d7ce);this.ribbon(hw-.2,hw+.5,.07,0xd4d7ce);
    for(let side=0;side<2;side++){
      const sg=side?1:-1;
      this.ribbon((p)=>sg*(hw+1),(p)=>sg*Math.max(hw+1,(p[4+side]||hw+5)-2),.025,0xa99e82,p=>p[8+side]===1);
      this.ribbon((p)=>sg*(hw+1),(p)=>sg*Math.max(hw+1,(p[4+side]||hw+5)-2),.03,0x777d76,p=>p[8+side]===2);
      this.ribbon(sg*hw,sg*(hw+2.5),.12,0xc7473b,(p,i)=>!!p[6+side]&&Math.floor(i*this.track.ds/5)%2===0);
      this.ribbon(sg*hw,sg*(hw+2.5),.13,0xe5e2d3,(p,i)=>!!p[6+side]&&Math.floor(i*this.track.ds/5)%2===1);
      for(let s=0;s<this.track.L;s+=10){const p=points[Math.floor(s/this.track.ds)%points.length],bar=p[4+side];if(bar>0){const q=this.at(s,sg*bar);this.instances.add('steel',0xa2acaa,q.x,1.9,q.z,10.2,2.7,.65,-q.h);if(Math.floor(s/10)%2===0)this.instances.add('steel',0x5b6968,q.x,1.5,q.z,.6,3,.6);}}
    }
    // Start/finish paint follows the same track basis as the live start line.
    for(let col=0;col<10;col++)for(let row=0;row<2;row++){const q=this.at(row*1.5,(col+.5)*this.track.width/10-hw);this.instances.add('box',(col+row)%2?0xeeeeea:0x20282a,q.x,.18,q.z,1.5,.1,this.track.width/10,-q.h);}
    this.buildPits();this.track.stands.forEach((st,i)=>this.buildStand(st,i));this.buildScenery();
    this.track.lights?.forEach(([x,z])=>{this.instances.add('steel',0x526565,x,15,z,.8,30,.8);this.instances.add('lamp',0xfff1cb,x,30,z,5,1,3);this.addLightFixture(x,z);});
    this.instances.finish();
    // A fixed pool bounds shader cost even on circuits with many light poles.
    this.floodlights=Array.from({length:Math.min(6,this.lightFixtures.length)},()=>{
      const light=new THREE.SpotLight(0xffe6bd,0,200,.95,.75,2);
      this.world.add(light,light.target);return light;
    });
    for(const roster of manifest.roster){const model=createCar(roster);model.userData.carId=roster.id;this.world.add(model);this.models.set(roster.id,model);model.visible=false;}
    this.labels=new DriverLabels(this.world,manifest.roster);this.labels.enabled=this.namesEnabled!==false;
    this.weatherEffects=new WeatherEffects(this.world,this.track,(s,d)=>this.at(s,d));this.setEffects(this.effectsEnabled!==false);
    const marshal=this.at(5,this.track.width/2+8);this.atmosphere.flag(marshal.x,0,marshal.z,marshal.h,0xffffff,true);
    this.poseById.clear();this.standIndex=0;this.row=1;this.follow=-1;this.selectMode(this.track.stands.length?'stands':'overview');this.setLighting(0,0,0);
  }
  ribbon(d0,d1,height,material,predicate=()=>true){
    const positions=[],pts=this.track.points,n=pts.length;
    for(let i=0;i<n;i++){const a=pts[i],b=pts[(i+1)%n];if(!predicate(a,i))continue;const vert=(p,d)=>[p[0]-p[3]*d,height,p[1]+p[2]*d];const lo=p=>typeof d0==='function'?d0(p):d0,hi=p=>typeof d1==='function'?d1(p):d1;
      const v=[vert(a,lo(a)),vert(a,hi(a)),vert(b,lo(b)),vert(b,hi(b))];positions.push(...v[0],...v[2],...v[1],...v[1],...v[2],...v[3]);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
    const mesh=new THREE.Mesh(g,typeof material==='number'?new THREE.MeshStandardMaterial({color:material,roughness:1,side:THREE.DoubleSide}):material);mesh.receiveShadow=true;this.world.add(mesh);return mesh;
  }
  buildPits(){const p=this.track.pits;if(!p?.has)return;const hw=this.track.width/2,sg=p.side;
    for(let s=p.s0;s<p.s1;s+=4){const q=this.at(s,sg*(hw+13));this.instances.add('box',0x767d77,q.x,.06,q.z,4.2,.1,17,-q.h);}
    let bay=0;
    for(let s=p.s0+15;s<p.s1-15;s+=23){const q=this.at(s,sg*(hw+34));this.instances.add('box',0xc1c3b5,q.x,8,q.z,21,16,20,-q.h);this.instances.add('box',0x344a4e,q.x,16.5,q.z,23,.6,23,-q.h);const front=this.at(s,sg*(hw+23.8));this.instances.add('box',0x2d4246,front.x,5,front.z,16,9,.3,-q.h);
      for(let y=1;y<9;y+=1.4)this.instances.add('steel',0x4e5c60,front.x,y,front.z,15.8,.08,.36,-q.h);
      this.instances.add('glass',0x365367,front.x,12.9,front.z,17,2.1,.38,-q.h);
      const awning=this.at(s,sg*(hw+22.5));this.instances.add('box',[0xbb4b38,0x427387,0xb6a36b][bay%3],awning.x,10.3,awning.z,19,.3,3.5,-q.h);
      for(const dx of [-8.5,0,8.5]){const pillar=this.at(s+dx,sg*(hw+23.6));this.instances.add('steel',0xb5c0ba,pillar.x,12.9,pillar.z,.18,2.2,.45);}
      bay++;
    }
    const q=this.at((p.s0+p.s1)/2,sg*(hw+43));this.banner(q.x,19,q.z,q.h,'PIT LANE',0x253b43);
  }
  buildStand(st,index){const sg=st.side?1:-1,rows=6,depth=(st.d1-st.d0)/rows;
    for(const end of [-1,1]){const q=this.at(st.sc+end*st.half,sg*(st.d1+3));this.atmosphere.flag(q.x,0,q.z,q.h,[0xe8f388,0xbd5245,0x4c8aab][index%3]);}
    for(let r=0;r<rows;r++)for(let s=st.sc-st.half+2;s<st.sc+st.half;s+=4.4){const d=sg*(st.d0+(r+.5)*depth),q=this.at(s,d),y=(r+1)*1.8;
      this.instances.add('box',0x89928a,q.x,y/2,q.z,4.5,y,depth+.15,-q.h);
      const central=Math.abs(s-st.sc)<7;
      if(!central){const seat=this.at(s,d);this.instances.add('seat',index%2?0xbcb78a:0x315964,seat.x,y+.65,seat.z,2.6,.40,2.5,-q.h);
        const back=this.at(s,d+sg*1.1);this.instances.add('seat',index%2?0xbcb78a:0x315964,back.x,y+1.65,back.z,2.6,2.2,.28,-q.h);
        for(const offset of [-.85,.85]){const leg=this.at(s+offset,d);this.instances.add('steel',0x5b6667,leg.x,y+.32,leg.z,.16,.64,1.7,-q.h);}
        const hash=Math.abs(Math.sin(s*21.67+r*34.8));if(hash>.13)this.buildSpectator(s,d,y,sg,hash,r);
      }
    }
    for(let s=st.sc-st.half;s<st.sc+st.half;s+=7){const q=this.at(s,sg*(st.d0-1));this.instances.add('steel',0xc1c9c2,q.x,2.3,q.z,.3,4.6,.3);for(const h of [2.6,4.4])this.instances.add('steel',0xc1c9c2,q.x,h,q.z,7.3,.22,.22,-q.h);}
    if(index%3===0)for(let s=st.sc-st.half+10;s<st.sc+st.half;s+=20){
      const mid=this.at(s,sg*(st.d0+st.d1)/2),rear=this.at(s,sg*(st.d1+1));
      this.instances.add('box',index===0?0xe2e0d1:0x547478,mid.x,18.8,mid.z,20.4,.35,st.d1-st.d0+5,-mid.h);
      this.instances.add('steel',0x506063,rear.x,9.3,rear.z,.7,18.6,.7);
      this.instances.add('steel',0x657577,mid.x,18.1,mid.z,.35,.8,st.d1-st.d0+5,-mid.h);
    }
    for(const end of [-1,1]){const q=this.at(st.sc+end*st.half,sg*(st.d1+1));this.instances.add('steel',0x56696c,q.x,15,q.z,1.4,30,1.4);this.instances.add('lamp',0xfff0be,q.x,30,q.z,6,1.2,3,-q.h);this.addLightFixture(q.x,q.z);}
    const q=this.at(st.sc,sg*(st.d0-2));this.banner(q.x,2.1,q.z,q.h+(st.side?0:Math.PI),'RACE TRACK',0x203a41);
  }
  buildSpectator(s,d,y,sg,hash,row){
    const colors=[0xe5dfca,0xb94b3e,0x294f68,0xd4a339,0x63849a,0x597366,0x79587f];
    const shirt=colors[Math.floor(hash*100)%colors.length],skin=[0xc68d69,0xe7ba96,0x845840,0xb17956][Math.floor(hash*97)%4],pants=[0x263a4e,0x444743,0x69655a][row%3];
    const point=(dx,dy,dz)=>{const p=this.at(s+dx,d+sg*dz);return[p.x,y+dy,p.z];};
    const add=(kind,color,dx,dy,dz,sx,sy,sz)=>{const p=point(dx,dy,dz);this.instances.add(kind,color,...p,sx,sy,sz,-this.at(s,d).h);};
    add('body',shirt,0,2.05,0,1.85,1.9,1.4);
    add('head',skin,0,3.65,-.08,1.25,1.45,1.25);
    add('hair',[0x352a25,0x675040,0xb39666,0x29282a][Math.floor(hash*87)%4],0,3.74,0,1.29,1.38,1.29);
    add('head',skin,0,3.55,-.68,.27,.35,.28);
    for(const side of [-1,1]){
      const raised=hash>.87&&side===1;
      const elbow=point(side*1.02,raised?3.4:1.68,raised?-.10:-.55),hand=point(side*.88,raised?4.3:1.35,raised?-.3:-1.05);
      if(!(raised&&this.atmosphere.waveArm(point(side*.68,2.7,0),elbow,hand,shirt,skin))){
        this.instances.segment(shirt,point(side*.68,2.7,0),elbow,.55);
        this.instances.segment(skin,elbow,hand,.38);
        add('head',skin,side*.88,raised?4.3:1.35,raised?-.3:-1.05,.45,.5,.45);
      }
      this.instances.segment(pants,point(side*.43,1.1,0),point(side*.48,1.0,-1.15),.66);
      this.instances.segment(pants,point(side*.48,1.0,-1.15),point(side*.48,.25,-1.3),.46);
      add('seat',0x292e31,side*.48,.18,-1.55,.56,.30,.87);
    }
    if(hash>.65){add('hair',shirt,0,3.87,-.02,1.40,1.2,1.40);add('seat',shirt,0,3.94,-.67,1.18,.12,.72);}
  }
  banner(x,y,z,heading,text,color){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;const c=canvas.getContext('2d');c.fillStyle='#'+color.toString(16).padStart(6,'0');c.fillRect(0,0,512,96);c.fillStyle='#e8f388';c.font='bold 44px sans-serif';c.textAlign='center';c.fillText(text,256,64);const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.MeshStandardMaterial({map:tex,roughness:.9});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(27,5),mat);mesh.position.set(x,y,z);mesh.rotation.y=-heading;const back=mesh.clone();back.rotation.y+=Math.PI;this.world.add(mesh,back);}
  buildScenery(){let seed=9127;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<1100;i++){const x=this.bounds.minX+random()*(this.bounds.maxX-this.bounds.minX),z=this.bounds.minZ+random()*(this.bounds.maxZ-this.bounds.minZ);if(this.track.points.some((p,j)=>j%3===0&&Math.hypot(p[0]-x,p[1]-z)<100))continue;const h=17+random()*24;this.instances.add('trunk',0x6a6150,x,h*.28,z,1.8,h*.56,1.8);
      if(i%3===0){for(let k=0;k<3;k++)this.instances.add('leaf',[0x4e704d,0x5e7d52,0x718650][k],x+(k-1)*h*.17,h*(.58+k*.08),z+(k%2)*h*.13,h*.65,h*.57,h*.62);}
      else for(let k=0;k<3;k++)this.instances.add('tree',[0x365e49,0x47694b,0x577751][k],x,h*(.4+k*.22),z,h*(.55-k*.12),h*.52,h*(.55-k*.12));
    }
  }
  selectMode(mode){this.mode=mode;this.drag=null;this.orbit.enabled=mode==='overview';this.resetView();if(mode==='overview'){this.camera.position.copy(this.center).add(v3(280,640,510));this.orbit.target.copy(this.center);this.orbit.update();}}
  resetView(){this.yaw=0;this.pitch=0;this.fov=60;this.follow=-1;this.tvCamera.reset();}
  setTV(mode,driver,angle){this.director?.configure(mode,driver,angle);this.resetView();}
  isOnboard(){return this.mode==='tv'&&isOnboard(this.director?.angle);}
  canOrbitTV(){return this.mode==='tv'&&!this.isOnboard()&&['leader','driver'].includes(this.director?.mode);}
  setEffects(enabled){this.effectsEnabled=enabled;if(this.weatherEffects)this.weatherEffects.enabled=enabled;if(this.atmosphere)this.atmosphere.enabled=enabled;}
  setNames(enabled){this.namesEnabled=enabled;if(this.labels)this.labels.enabled=enabled;}
  pickCar(x,y){
    if(!this.world)return;const rect=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),this.camera);
    const targets=this.world.children.filter(o=>o!==this.weatherEffects?.group&&o!==this.atmosphere?.group);
    for(const hit of ray.intersectObjects(targets,true)){
      let object=hit.object,visible=true,id;for(let p=object;p;p=p.parent){if(!p.visible)visible=false;if(p.userData.carId!==undefined)id=p.userData.carId;}
      if(!visible||object.material?.isShaderMaterial||object.isLight)continue;
      if(id!==undefined&&!this.rosterById.get(id)?.safety)this.onSelectDriver?.(id);
      break;
    }
  }
  nextTV(){this.director?.next();}
  setSeat(index,row){this.standIndex=index;this.row=row;this.resetView();}
  addLightFixture(x,z){
    let nearest=this.track.points[0],distance=Infinity;
    for(const p of this.track.points){const d=(p[0]-x)**2+(p[1]-z)**2;if(d<distance){distance=d;nearest=p;}}
    this.lightFixtures.push({position:v3(x,30,z),target:v3(nearest[0],0,nearest[1])});
  }
  updateFloodlights(focus){
    if(!this.lightFocus||this.lightFocus.distanceToSquared(focus)>400){
      const nearest=[...this.lightFixtures].sort((a,b)=>a.position.distanceToSquared(focus)-b.position.distanceToSquared(focus));
      this.floodlights.forEach((light,i)=>{light.position.copy(nearest[i].position);light.target.position.copy(nearest[i].target);});
      this.lightFocus=focus.clone();
    }
    for(const light of this.floodlights)light.intensity=10000*this.lampStrength;
  }
  setLighting(night,wet,weather){if(this.lastLight!==undefined&&Math.abs(this.lastLight-night)<.015&&this.lastWet===wet&&this.lastWeather===weather)return;this.lastLight=night;this.lastWet=wet;this.lastWeather=weather;
    const darkness=THREE.MathUtils.smoothstep(clamp(night,0,1),0,1),daylight=(1-darkness)**2;
    const cloud=[0,.3,.65,.8,.95,.6,.55,0][weather]??0;
    const sky=new THREE.Color(0xbacfd4).lerp(new THREE.Color(0x657781),cloud*.65).lerp(new THREE.Color(0x050a14),darkness);
    this.scene.background=sky;this.scene.fog=new THREE.Fog(sky,weather===6?130:650-darkness*180-cloud*250,weather===6?650:1900-darkness*450-cloud*600);
    this.hemi.intensity=.12+1.38*daylight*(1-cloud*.25);
    this.hemi.color.set(0xdcebf4).lerp(new THREE.Color(0x7393c6),darkness);
    this.hemi.groundColor.set(0x64714b).lerp(new THREE.Color(0x182030),darkness);
    this.sun.intensity=.08+2.52*daylight*(1-cloud*.85);this.sun.color.set(0xffeed2).lerp(new THREE.Color(0x91b1df),darkness);
    this.scene.environmentIntensity=.025+.425*daylight;
    this.renderer.toneMappingExposure=1-darkness*.06;
    this.lampStrength=THREE.MathUtils.smoothstep(night,.3,.85);
    if(this.instances.lampMaterial)this.instances.lampMaterial.emissiveIntensity=.05+3*this.lampStrength;
    this.roadMat.roughness=.95-wet*.6;this.roadMat.color.set(0x454d4c).multiplyScalar(1-wet*.25);
  }
  update(frame){if(!frame)return;this.frame=frame;this.poseById=new Map(frame.cars.map(c=>[c[0],c]));for(const[id,model]of this.models){const p=this.poseById.get(id);model.visible=!!p;animateCar(model,p,frame.t);if(p){model.position.set(p[1],.1,p[2]);model.rotation.y=-p[3];updateVehicleLights(model.userData.lights,frame.night,p[8]);}}if(this.mode==='tv')this.tvShot=this.director.update(frame);this.setLighting(frame.night,frame.wet,frame.weather);}
  render(){if(!this.track)return;
    if(this.camera.fov!==this.fov){this.camera.fov=this.fov;this.camera.updateProjectionMatrix();}
    let tvFocus=null;
    if(this.mode==='stands'&&this.track.stands.length){const st=this.track.stands[this.standIndex]??this.track.stands[0],r=[0,3,5][this.row],d=(st.side?1:-1)*(st.d0+(r+.5)*(st.d1-st.d0)/6),q=this.at(st.sc,d),target=this.at(st.sc+18);
      this.camera.position.set(q.x,(r+1)*1.8+5.1,q.z);const car=this.poseById.get(this.follow);let aim=car?v3(car[1],2.5,car[2]):v3(target.x,2.5,target.z);const dir=aim.sub(this.camera.position);const yaw=Math.atan2(dir.z,dir.x)+this.yaw,pitch=clamp(Math.atan2(dir.y,Math.hypot(dir.x,dir.z))-this.pitch,-1.25,1.25);this.camera.lookAt(this.camera.position.clone().add(v3(Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch),Math.sin(yaw)*Math.cos(pitch))));
    }else if(this.mode==='tv'&&this.tvShot&&this.frame){
      const id=this.tvShot.ids[0],p=this.poseById.get(id),r=this.rosterById.get(id);
      if(this.isOnboard()&&p&&r)tvFocus=updateOnboard(this.camera,p,r,this.tvShot.angle,this.yaw,-this.pitch);
      else tvFocus=this.tvCamera.update(this.camera,this.tvShot,this.poseById,this.frame,this.center,this.track);
    }
    else if(this.mode==='overview')this.orbit.update();
    // Keep shadow detail around the selected seat or orbit target, not the whole world.
    const focus=tvFocus??(this.mode==='stands'?this.camera.position:this.orbit.target);this.sun.target.position.set(focus.x,0,focus.z);this.sun.position.set(focus.x+180,440,focus.z-180);
    this.updateFloodlights(focus);
    this.labels?.update(this.camera,this.poseById,this.mode==='tv'?this.tvShot?.ids[0]:this.follow,this.isOnboard(),this.mode==='overview');
    this.weatherEffects?.update(this.frame,this.camera,this.rosterById);this.atmosphere?.update(this.frame);
    this.renderer.render(this.scene,this.camera);
  }
}

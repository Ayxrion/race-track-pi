import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CarMotion } from './car-motion.js';
import { createVehicleLights } from './car-lights.js';
import { vehicleDesign } from './vehicle-design.js';
import { buildMotorcycle, buildKart, buildLightWheel } from './light-vehicles.js';

// Original procedural models. X points forward; dimensions come from the device.
// Static components are merged by material to keep a full grid inexpensive.
class CarBuilder {
  constructor() { this.parts = new Map(); this.transform = new THREE.Object3D(); }
  add(geometry, material, position = [0,0,0], rotation = [0,0,0]) {
    this.transform.position.set(...position); this.transform.rotation.set(...rotation); this.transform.updateMatrix();
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.applyMatrix4(this.transform.matrix);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
  }
  box(x,y,z,l,h,w,mat,radius=.08,rotation=[0,0,0]) {
    this.add(new RoundedBoxGeometry(l,h,w,2,Math.min(radius,l*.24,h*.24,w*.24)),mat,[x,y,z],rotation);
  }
  rod(from,to,radius,mat) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(radius,radius,delta.length(),6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    this.add(g,mat,a.add(b).multiplyScalar(.5).toArray());
  }
  loft(sections, mat, position=[0,0,0]) {
    const vertices=[], indices=[];
    for (const [x,lo,hi,w] of sections) {
      const bevel=Math.min((hi-lo)*.22,w*.16);
      for(const [y,z] of [[lo,-w*.8],[lo+bevel,-w],[hi-bevel,-w],[hi,-w*.8],[hi,w*.8],[hi-bevel,w],[lo+bevel,w],[lo,w*.8]]) vertices.push(x,y,z);
    }
    for(let s=0;s<sections.length-1;s++) for(let j=0;j<8;j++) {
      const a=s*8+j, n=s*8+(j+1)%8, b=a+8, m=n+8; indices.push(a,n,b,n,m,b);
    }
    for(let i=1;i<7;i++) { indices.push(0,i+1,i);const end=(sections.length-1)*8;indices.push(end,end+i,end+i+1); }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();this.add(g,mat,position);
  }
  panel(points,mat,reverse=false){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));
    g.setIndex(reverse?[0,2,1,0,3,2]:[0,1,2,0,2,3]);g.computeVertexNormals();this.add(g,mat);
  }
  shell(design,mat){
    const {bodyTop,bodyBottom,R,wheelX,halfWidth}=design,shape=new THREE.Shape();
    shape.moveTo(bodyTop[0][0],bodyBottom);
    for(let i=0;i<bodyTop.length;i++){
      const p=bodyTop[i],a=bodyTop[i-1]??[p[0],bodyBottom],b=bodyTop[i+1]??[p[0],bodyBottom];
      const da=Math.hypot(p[0]-a[0],p[1]-a[1]),db=Math.hypot(b[0]-p[0],b[1]-p[1]),round=Math.min(.24,da*.2,db*.2);
      shape.lineTo(p[0]+(a[0]-p[0])*round/da,p[1]+(a[1]-p[1])*round/da);
      shape.quadraticCurveTo(p[0],p[1],p[0]+(b[0]-p[0])*round/db,p[1]+(b[1]-p[1])*round/db);
    }
    shape.lineTo(bodyTop.at(-1)[0],bodyBottom);
    // Cut real open wheel arches into the bottom contour, including the far side.
    const arch=R*1.17;
    for(const x of [wheelX,-wheelX]){
      shape.lineTo(x+arch,bodyBottom);shape.lineTo(x+arch,R);
      for(let i=1;i<=20;i++){const a=i*Math.PI/20;shape.lineTo(x+Math.cos(a)*arch,R+Math.sin(a)*arch);}
      shape.lineTo(x-arch,bodyBottom);
    }
    shape.closePath();
    const bevel=.065,g=new THREE.ExtrudeGeometry(shape,{depth:halfWidth*2-bevel*2,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,steps:1,curveSegments:20});
    this.add(g,mat,[0,0,-halfWidth+bevel]);
  }
  finish() {
    const group=new THREE.Group();
    for(const [material,parts] of this.parts) {
      const geometry=mergeGeometries(parts);parts.forEach(p=>p.dispose());
      const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
    }
    return group;
  }
}

function numberMaterial(number) {
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=96;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#f3f0e5';ctx.fillRect(0,0,128,96);
  ctx.fillStyle='#16222d';ctx.fillRect(0,0,128,13);ctx.fillStyle='#18232b';ctx.font='italic 800 67px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(number),64,57,114);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map:texture,roughness:.55});
}

export function createCar(r) {
  const b=new CarBuilder(), L=r.len, W=r.wid, cls=r.cls,design=vehicleDesign(r);
  const formula=cls===0, proto=cls===1, gt=cls===2, touring=cls===3, classic=cls===4, van=cls===5, bike=cls===6, kart=cls===7, open=formula||classic;
  const paint=new THREE.MeshPhysicalMaterial({color:r.colors[0],roughness:.28,metalness:.32,clearcoat:.8,clearcoatRoughness:.22});
  const trim=new THREE.MeshStandardMaterial({color:r.colors[1],roughness:.35,metalness:.3});
  const accent=new THREE.MeshStandardMaterial({color:r.colors[2],roughness:.4,metalness:.2});
  const carbon=new THREE.MeshStandardMaterial({color:0x172026,roughness:.68,metalness:.12});
  const glass=new THREE.MeshPhysicalMaterial({color:0x253f50,roughness:.13,metalness:.45,clearcoat:1});
  const rubber=new THREE.MeshStandardMaterial({color:0x17191c,roughness:.86});
  const alloy=new THREE.MeshStandardMaterial({color:classic?0xa7b6b9:0x778792,roughness:.3,metalness:.85});
  const tireMark=new THREE.MeshStandardMaterial({color:formula?0xe8ca48:0x454b50,roughness:.75});
  const {R,wheelX,wheelZ,tireWidth}=design;

  // Sculpted silhouettes differ for every racing class.
  if(bike||kart) {
    (bike?buildMotorcycle:buildKart)(b,design,{paint,trim,accent,carbon,glass,rubber,alloy});
  } else if(formula) {
    b.loft([[-L*.43,.6,1.65,W*.10],[-L*.23,.65,2.6,W*.17],[0,.65,2.25,W*.18],[L*.25,.7,1.7,W*.085],[L*.49,.7,1.15,W*.06]],paint);
    b.box(-L*.06,.55,0,L*.68,.2,W*.76,carbon);
    for(const side of [-1,1]) {
      b.box(-L*.10,1.25,side*W*.29,L*.35,1.35,W*.23,paint,.28);
      b.box(L*.075,1.45,side*W*.29,.14,.65,W*.17,carbon,.04);
      b.box(-L*.13,1.96,side*W*.28,L*.28,.08,W*.16,trim,.03);
      for(const ax of [-wheelX,wheelX]) {
        b.rod([ax-.5,.8,side*W*.10],[ax,R,side*wheelZ],.065,carbon);
        b.rod([ax+.6,1.5,side*W*.12],[ax,R,side*wheelZ],.065,carbon);
      }
    }
    b.box(L*.42,.7,0,L*.15,.19,W*.97,carbon,.08);
    b.box(L*.39,.98,0,L*.085,.13,W*.91,trim,.05);
    for(const side of [-1,1]) b.box(L*.42,1.0,side*W*.48,L*.17,.65,.11,paint,.06);
    b.box(-L*.41,3.0,0,L*.115,.22,W*.91,paint,.08);
    b.box(-L*.42,3.28,0,L*.08,.12,W*.92,trim,.04);
    for(const side of [-1,1]) {
      b.box(-L*.40,2.95,side*W*.46,L*.15,.95,.12,accent,.04);
      b.box(-L*.40,1.75,side*W*.20,.14,2.5,.14,carbon,.03);
      b.rod([-L*.10,2.10,side*W*.16],[-L*.10,2.8,side*W*.16],.10,carbon);
      b.rod([-L*.10,2.8,side*W*.16],[L*.065,2.9,side*W*.12],.10,carbon);
    }
    b.rod([L*.065,2.9,-W*.12],[L*.065,2.9,W*.12],.10,carbon);
    b.rod([L*.065,2.9,0],[L*.11,2.0,0],.095,carbon);
    b.loft([[-L*.29,1.9,2.0,.45],[-L*.22,1.9,3.15,.4],[-L*.12,1.9,3.25,.32]],paint);
    for(const side of [-1,1]){
      b.rod([0,2.0,side*W*.17],[L*.02,2.45,side*W*.28],.075,carbon);
      b.box(L*.02,2.45,side*W*.29,.65,.30,.32,paint,.10);
      for(let j=0;j<4;j++)b.box(-L*(.12+j*.025),1.97,side*W*.28,.12,.025,W*.12,carbon,.01);
    }
  } else if(classic) {
    b.loft([[-L*.48,.8,1.35,W*.08],[-L*.26,.5,2.0,W*.22],[L*.05,.6,1.85,W*.21],[L*.35,.75,1.65,W*.16],[L*.48,.8,1.2,W*.1]],paint);
    b.panel([[L*.05,1.875,-W*.08],[L*.35,1.675,-W*.08],[L*.35,1.675,W*.08],[L*.05,1.875,W*.08]],trim,true);
    for(const side of [-1,1]) {
      for(const ax of [-wheelX,wheelX]) b.rod([ax,1,0],[ax,R,side*wheelZ],.10,alloy);
      b.rod([-L*.38,1.1,side*W*.23],[L*.03,1.1,side*W*.23],.13,alloy);
    }
    b.box(L*.03,2.05,0,.15,.55,W*.34,glass,.04,[0,0,-.25]);
    b.add(new THREE.TorusGeometry(.58,.09,6,12,Math.PI),alloy,[-L*.18,2.3,0],[0,Math.PI/2,0]);
    for(const side of [-1,1])b.rod([-L*.18,1.8,side*.58],[-L*.18,2.3,side*.58],.09,alloy);
    for(let j=0;j<5;j++)b.box(L*(.10+j*.035),1.8-j*.025,0,.045,.04,W*.20,carbon,.01);
  } else if(proto) {
    b.shell(design,paint);
    b.loft([[-L*.28,1.5,1.6,W*.12],[-L*.12,1.5,3.15,W*.20],[L*.08,1.45,3.05,W*.19],[L*.27,1.35,1.45,W*.11]],glass);
    b.loft([[-L*.12,3.12,3.22,W*.14],[L*.08,3.02,3.12,W*.14]],paint);
    for(const side of [-1,1]) {
      b.box(0,1.4,side*W*.46,L*.25,.45,.1,carbon,.04);
      b.box(-L*.36,2.83,side*W*.25,.15,.64,.15,carbon,.03);
      b.rod([L*.03,2.4,side*W*.19],[L*.06,2.65,side*W*.29],.065,carbon);
      b.box(L*.06,2.65,side*W*.29,.55,.25,.3,paint,.08);
    }
    b.box(-L*.40,3.17,0,L*.14,.22,W*.98,trim,.08);
    b.box(-L*.26,2.25,0,L*.32,1.5,.13,accent,.04);
    b.box(L*.45,.5,0,L*.12,.12,W*.96,carbon,.03);
    for(const side of [-1,1])for(let j=0;j<4;j++)b.box(L*(.27+j*.025),2.57,side*W*.29,.12,.025,W*.13,carbon,.01);
  } else if(van) {
    b.shell(design,paint);
    // Solid panel van with a short bonnet and a raked, framed windscreen.
    const sideZ=W*.461;
    b.panel([[L*.331+.085,3.78,W*.375],[L*.331+.085,3.78,-W*.375],[L*.181+.085,6.14,-W*.375],[L*.181+.085,6.14,W*.375]],glass);
    const windscreen=[[L*.331+.085,3.78,W*.375],[L*.331+.085,3.78,-W*.375],[L*.181+.085,6.14,-W*.375],[L*.181+.085,6.14,W*.375]];
    windscreen.forEach((p,i)=>b.rod(p,windscreen[(i+1)%4],.065,carbon));
    for(const side of [-1,1]){
      const z=side*sideZ;
      b.panel([[-L*.025,3.18,z],[L*.293,3.18,z],[L*.173,5.99,z],[-L*.025,5.99,z]],glass,side<0);
      b.box(-L*.04,3.5,z,.13,5.1,.09,carbon,.025);
      b.box(-L*.265,3.65,z,L*.36,3.55,.055,paint,.10);
      b.box(-L*.065,3.4,z,.045,5.1,.065,carbon,.01);
      b.box(-L*.26,1.25,z,L*.38,.045,.07,carbon,.01);
      b.box(-L*.26,5.55,z,L*.38,.045,.07,carbon,.01);
      b.box(-L*.455,3.4,z,.045,4.5,.07,carbon,.01);
      b.box(-L*.12,2.9,z,.50,.12,.10,carbon,.035);
      b.box(L*.005,2.9,z,.48,.12,.11,carbon,.035);
      b.box(-L*.02,1.18,z,L*.78,.22,.11,carbon,.04);
      b.box(L*.10,.67,side*W*.47,L*.22,.18,.30,carbon,.04);
      b.rod([L*.20,3.65,side*W*.45],[L*.19,3.65,side*W*.54],.09,carbon);
      b.box(L*.19,3.78,side*W*.55,.48,.90,.30,carbon,.12);
      b.box(L*.169,3.80,side*W*.55,.045,.68,.22,alloy,.04);
      b.box(-L*.484,3.6,side*W*.225,.045,4.35,W*.405,paint,.07);
      for(const y of [2.0,4.7])b.box(-L*.48-.09,y,side*W*.405,.085,.32,.16,alloy,.025);
      b.box(-L*.48-.10,2.75,side*W*.055,.09,.38,.10,carbon,.02);
    }
    b.box(-L*.48-.07,3.6,0,.07,4.75,.055,carbon,.01);
    b.box(L*.483,1.47,0,.16,.65,W*.46,carbon,.08);
    for(const y of [1.25,1.47,1.69])b.box(L*.48+.13,y,0,.08,.055,W*.42,alloy,.02);
    b.box(L*.48+.08,.81,0,.25,.43,W*.89,carbon,.09);
    b.box(-L*.48-.08,.81,0,.25,.43,W*.89,carbon,.09);
    b.box(L*.48+.175,1.48,0,.07,.19,.32,alloy,.04);
    b.box(-L*.48-.075,1.55,0,.06,.40,1.05,trim,.03);
    for(const side of [-1,1])b.rod([L*.331+.12,3.80,side*W*.23],[L*.280+.12,4.62,side*W*.05],.035,carbon);
    b.box(-L*.08,6.27,0,L*.47,.07,W*.65,paint,.03);
  } else {
    b.shell(design,paint);
    const roof=touring?3.9:3.5,rear=touring?-.34:-.31,roofRear=touring?-.23:-.16,roofFront=.08,front=.26;
    b.loft([[L*rear,2.0,2.18,W*.33],[L*roofRear,2.0,roof,W*.31],[L*roofFront,2.0,roof,W*.30],[L*front,2.0,2.18,W*.33]],glass);
    b.box(L*(roofRear+roofFront)/2,roof,0,L*(roofFront-roofRear),.16,W*.63,paint,.07);
    for(const side of [-1,1]){
      b.rod([L*roofFront,roof,side*W*.30],[L*front,2.12,side*W*.33],.095,paint);
      b.rod([L*roofRear,roof,side*W*.31],[L*rear,2.12,side*W*.33],.105,paint);
      b.rod([-L*.07,2.05,side*W*.325],[-L*.07,roof,side*W*.31],.09,carbon);
      b.box(L*.11,2.5,side*W*.43,.65,.34,.40,paint,.11);
      b.rod([L*.10,2.4,side*W*.32],[L*.11,2.5,side*W*.43],.075,carbon);
      b.box(L*.11-.34,2.5,side*W*.43,.05,.22,.28,alloy,.03);
      b.box(-L*.06,1.92,side*W*.462,.48,.11,.06,carbon,.02);
      b.box(L*.14,1.40,side*W*.462,.035,1.30,.06,carbon,.01);
      b.box(0,.65,side*W*.46,L*.35,.22,.21,carbon,.03);
      for(let j=0;j<3;j++)b.box(L*(.265+j*.027),2.57,side*W*.27,.10,.025,W*.13,carbon,.01);
      b.box(-L*.33,2.85,side*W*.25,.14,.75,.14,carbon,.03);
    }
    b.box(-L*.35,3.28,0,L*.13,.19,W*.91,carbon,.05);
    for(const side of [-1,1])b.box(-L*.35,3.30,side*W*.46,L*.14,.45,.10,paint,.03);
    b.box(L*.482,1.02,0,.12,.50,W*.43,carbon,.05);
    b.box(L*.48,.59,0,L*.07,.17,W*.92,carbon,.03);
    b.box(-L*.48,.62,0,.13,.26,W*.83,carbon,.03);
    b.box(L*.30,2.57,0,L*.13,.03,W*.17,trim,.01);
    b.box(L*(roofRear+roofFront)/2,roof+.085,0,L*(roofFront-roofRear)*.92,.02,W*.16,trim,.005);
    for(const side of [-1,1])b.add(new THREE.CylinderGeometry(.12,.12,.30,10),alloy,[-L*.49,.77,side*W*.23],[0,0,Math.PI/2]);
  }


  if(open) {
    b.box(-L*.08,2.05,0,L*.17,.35,W*.30,carbon,.16);
    b.add(new THREE.SphereGeometry(.56,12,8),trim,[-L*.09,2.65,0]);
    b.box(-L*.055,2.68,0,.35,.20,.95,glass,.08);
  }
  // Rounded slick tires, recessed metallic rims, spokes and sidewall rings.
  // Each wheel has a steering pivot and a separate axle rotation; body parts
  // remain merged. Wheel geometry is centered on its axle, not the car origin.
  const wheels=[];
  for(const x of [-wheelX,wheelX]) for(const wheelSide of bike?[0]:[-1,1]) {
    const w=new CarBuilder();
    let actualWidth=tireWidth;
    if(bike||kart)actualWidth=buildLightWheel(w,design,x>0,{rubber,carbon,alloy,trim},bike);
    else {
    w.add(new THREE.CylinderGeometry(R,R,tireWidth,20),rubber,[0,0,0],[Math.PI/2,0,0]);
    for(const side of [wheelSide]){
    const face=side*tireWidth*.5;
    w.add(new THREE.TorusGeometry(R*.88,R*.12,8,24),rubber,[0,0,face]);
    w.add(new THREE.CylinderGeometry(R*.63,R*.63,.08,16),carbon,[0,0,face+side*.025],[Math.PI/2,0,0]);
    w.add(new THREE.TorusGeometry(R*.56,.075,5,16),alloy,[0,0,face+side*.08]);
    w.add(new THREE.TorusGeometry(R*.87,.027,4,20),tireMark,[0,0,face+side*.09]);
    // A small sidewall mark makes rolling readable even on dark wheels.
    w.box(0,R*.84,face+side*.105,R*.13,R*.12,.025,tireMark,.01);
    for(let j=0;j<(classic?8:5);j++) {
      const a=j*Math.PI*2/(classic?8:5);
      w.rod([0,0,face+side*.10],[Math.cos(a)*R*.53,Math.sin(a)*R*.53,face+side*.10],.055,alloy);
    }
    w.add(new THREE.CylinderGeometry(.15,.15,.12,8),accent,[0,0,face+side*.12],[Math.PI/2,0,0]);
    }
    }
    const axle=w.finish(),pivot=new THREE.Group();pivot.position.set(x,R,wheelSide*wheelZ);pivot.add(axle);
    if(bike){
      const z=actualWidth*.47+.075,caliper=new THREE.Mesh(new RoundedBoxGeometry(.23,.41,.18,2,.04),accent);caliper.position.set(-R*.38,R*.20,z);pivot.add(caliper);
      const anchor=new THREE.Vector3(0,0,z),end=new THREE.Vector3(-R*.38,R*.20,z),delta=end.clone().sub(anchor),bracket=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,delta.length(),6),alloy);
      bracket.position.copy(anchor).add(end).multiplyScalar(.5);bracket.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());pivot.add(bracket);
    }
    wheels.push({pivot,axle,front:x>0});
  }
  const number=numberMaterial(r.num??r.id+1);
  for(const side of [-1,1]) {
    const z=bike?.739:kart?W*.484:W*(open?(formula?.406:.217):van?.466:.462);
    b.add(new THREE.PlaneGeometry(bike?.78:kart?1.1:open?1.3:1.8,bike?.42:kart?.40:open?.95:1.3),number,[bike?.5:kart?-.22:van?-L*.26:-L*.08,bike?1.23:kart?.77:open?1.4:van?3.5:1.65,side*z],[0,side>0?0:Math.PI,0]);
  }
  if(bike)b.add(new THREE.PlaneGeometry(.45,.25),number,[L*.30+.02,3.17,0],[0,Math.PI/2,0]);
  if(kart){
    const slope=.19/.47,normal=new THREE.Vector3(1,slope,0).normalize(),up=new THREE.Vector3(-slope,1,0).normalize();
    const plate=new THREE.PlaneGeometry(.76,.46);plate.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,-1),up,normal));
    b.add(plate,number,[1.44-(1.92-1.67)*slope+.012,1.92,0]);
  }
  if(r.safety){b.box(0,design.roof+.12,0,1.6,.18,W*.67,carbon,.04);b.box(0,design.roof+.35,0,1.5,.35,W*.65,new THREE.MeshStandardMaterial({color:0xffab24,emissive:0xff8e00,emissiveIntensity:1.8}),.10);}
  const group=b.finish();group.userData.lights=createVehicleLights(r);group.add(group.userData.lights);
  group.add(...wheels.map(w=>w.pivot));
  group.userData.wheels=wheels;group.userData.motion=new CarMotion(R,wheelX*2,L);
  return group;
}

export function animateCar(model, pose, time) {
  const {motion,wheels}=model.userData;
  if(!pose){motion.reset();return;}
  motion.update(pose,time);
  for(const wheel of wheels){wheel.axle.rotation.z=motion.spin;wheel.pivot.rotation.y=wheel.front?motion.steer:0;}
}

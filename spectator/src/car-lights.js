import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { vehicleDesign } from './vehicle-design.js';

// Same night threshold as drawHeadlights() in the ESP32 renderer.
export function vehicleLightState(night, braking) {
  const headlights=night>=.3;
  return {headlights,tail:braking?3:headlights?.4:0,glow:braking?.65:headlights?.16:0,
    spill:braking?(headlights?.24:.08):headlights?.035:0};
}

function softMaterial(color, beam=false) {
  return new THREE.ShaderMaterial({
    uniforms:{color:{value:new THREE.Color(color)},strength:{value:0}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec2 vUv;uniform vec3 color;uniform float strength;
      void main(){float fade=${beam
        ? 'smoothstep(0.0,.08,vUv.y)*pow(1.0-vUv.y,1.6)*(1.0-smoothstep(.25,1.0,abs(vUv.x*2.0-1.0)))'
        : 'pow(max(0.0,1.0-length(vUv*2.0-1.0)),2.0)'};
        gl_FragColor=vec4(color,fade*strength);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
    side:beam?THREE.DoubleSide:THREE.FrontSide,
  });
}

function roadBeam(x,z,direction,length,width,material) {
  const g=new THREE.BufferGeometry(),tip=x+direction*length;
  g.setAttribute('position',new THREE.Float32BufferAttribute([
    x,.14,z-width*.08,x,.14,z+width*.08,tip,.14,z-width,tip,.14,z+width],3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));
  g.setIndex([0,2,1,1,2,3]);
  const mesh=new THREE.Mesh(g,material);mesh.renderOrder=2;return mesh;
}

export function createVehicleLights(r) {
  const group=new THREE.Group(),L=r.len,W=r.wid,design=vehicleDesign(r);
  const headMat=new THREE.MeshStandardMaterial({color:0xb8c8cf,emissive:0xfff1ce,emissiveIntensity:0,roughness:.25,toneMapped:false});
  const tailMat=new THREE.MeshStandardMaterial({color:0x780a08,emissive:0xff0904,emissiveIntensity:0,roughness:.3,toneMapped:false});
  const headGlow=softMaterial(0xffefcc),tailGlow=softMaterial(0xff180c);
  const beamMat=softMaterial(0xffefcc,true),spillMat=softMaterial(0xff1006,true);
  const heads=new THREE.Group(),tails=new THREE.Group(),beams=new THREE.Group(),spills=new THREE.Group();
  const housing=new THREE.MeshStandardMaterial({color:0x151a20,roughness:.42}),bezel=new THREE.MeshStandardMaterial({color:0x75818a,metalness:.8,roughness:.25});
  const reverse=new THREE.MeshStandardMaterial({color:0xe1e0d5,roughness:.3});
  const box=(x,y,z,depth,height,width,mat,radius=.03)=>{const mesh=new THREE.Mesh(new RoundedBoxGeometry(depth,height,width,2,Math.min(radius,depth*.4,height*.2,width*.2)),mat);mesh.position.set(x,y,z);group.add(mesh);return mesh;};
  for(const m of design.lamps){
    const front=m.kind==='head',direction=front?1:-1,mat=front?headMat:tailMat,glow=front?headGlow:tailGlow,glows=front?heads:tails;
    if(m.anchor){
      const a=new THREE.Vector3(...m.anchor),b=new THREE.Vector3(m.x-.10,m.y-m.height*.20,m.z),delta=b.clone().sub(a);
      const arm=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,delta.length(),8),housing);
      arm.position.copy(a).add(b).multiplyScalar(.5);arm.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());group.add(arm);
    }
    if((r.cls===6||r.cls===7)&&front){
      // Thin LED slit integrated into the light vehicle's nose, not a car pod.
      box(m.x,m.y,m.z,.10,m.height,m.width,housing,.025);
      box(m.x+.058,m.y,m.z,.012,m.height*.48,m.width*.83,mat,.012);
    }else if(m.round){
      const shell=new THREE.Mesh(new THREE.CylinderGeometry(m.height*.55,m.height*.48,.28,20),housing);shell.rotation.z=-direction*Math.PI/2;shell.position.set(m.x,m.y,m.z);group.add(shell);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(m.height*.42,m.height*.055,8,24),bezel);ring.rotation.y=direction*Math.PI/2;ring.position.set(m.x+direction*.145,m.y,m.z);group.add(ring);
      const lens=new THREE.Mesh(new THREE.CircleGeometry(m.height*.38,24),mat);lens.rotation.y=direction*Math.PI/2;lens.position.set(m.x+direction*.15,m.y,m.z);group.add(lens);
    }else{
      // The back of each housing penetrates the end cap; only the lens faces emit.
      box(m.x,m.y,m.z,.28,m.height,m.width,housing,.06);
      const x=m.x+direction*.15;
      if(front){
        for(const side of [-1,1]){
          const lens=new THREE.Mesh(new THREE.CircleGeometry(Math.min(m.height*.29,m.width*.18),16),mat);lens.rotation.y=direction*Math.PI/2;lens.position.set(x,m.y-m.height*.03,m.z+side*m.width*.24);group.add(lens);
        }
        box(x,m.y+m.height*.30,m.z,.025,m.height*.10,m.width*.74,mat,.008);
      }else if(r.cls===5){
        box(x,m.y-m.height*.25,m.z,.025,m.height*.36,m.width*.70,mat,.008);
        box(x,m.y+m.height*.29,m.z,.025,m.height*.26,m.width*.70,mat,.008);
        box(x,m.y+m.height*.02,m.z,.025,m.height*.17,m.width*.70,reverse,.008);
      }else box(x,m.y,m.z,.025,m.height*.58,m.width*.79,mat,.008);
    }
    const halo=new THREE.Mesh(new THREE.PlaneGeometry(m.width*2.0,m.height*2.1),glow);
    halo.rotation.y=direction*Math.PI/2;halo.position.set(m.x+direction*.17,m.y,m.z);glows.add(halo);
    if(front)beams.add(roadBeam(m.x+.18,m.z,1,L*2.6,W*.70,beamMat));
    else spills.add(roadBeam(m.x-.18,m.z,-1,L*.35,W*.24,spillMat));
  }
  group.add(heads,tails,beams,spills);
  group.userData={headMat,tailMat,headGlow,tailGlow,beamMat,spillMat,heads,tails,beams,spills,mounts:design.lamps};
  updateVehicleLights(group,0,false);return group;
}

export function updateVehicleLights(group,night,braking) {
  const s=vehicleLightState(night,braking),d=group.userData;
  d.headMat.emissiveIntensity=s.headlights?4:0;
  d.tailMat.emissiveIntensity=s.tail;
  d.headGlow.uniforms.strength.value=s.headlights?.65:0;
  d.tailGlow.uniforms.strength.value=s.glow;
  d.beamMat.uniforms.strength.value=s.headlights?.18+.16*Math.max(0,(night-.3)/.7):0;
  d.spillMat.uniforms.strength.value=s.spill;
  d.heads.visible=d.beams.visible=s.headlights;
  d.tails.visible=d.spills.visible=s.glow>0;
}

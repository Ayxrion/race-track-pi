import * as THREE from 'three';

// Camera movement only: it never changes or predicts car positions.
export class TVCamera {
  constructor(){this.position=new THREE.Vector3();this.aim=new THREE.Vector3();this.reset();}
  reset(){this.key=null;this.lastTime=null;this.heading=null;this.anchor=null;this.manualOrbit=false;this.orbitDirty=false;}
  beginOrbit(){
    if(this.manualOrbit)return;
    const offset=this.position.clone().sub(this.aim);
    this.orbitAzimuth=Math.atan2(offset.z,offset.x)-(this.heading??0);
    this.orbitElevation=THREE.MathUtils.clamp(Math.atan2(offset.y,Math.hypot(offset.x,offset.z)),.08,1.4);
    this.orbitDistance=THREE.MathUtils.clamp(offset.length()||50,18,200);this.manualOrbit=true;
  }
  orbitBy(dx,dy){this.beginOrbit();this.orbitAzimuth-=dx*.006;this.orbitElevation=THREE.MathUtils.clamp(this.orbitElevation+dy*.006,.08,1.4);this.orbitDirty=true;}
  zoomBy(delta){this.beginOrbit();this.orbitDistance=THREE.MathUtils.clamp(this.orbitDistance*Math.exp(delta*.001),18,200);this.orbitDirty=true;}
  update(camera,shot,poses,frame,center,track){
    const dt=this.lastTime===null?0:Math.max(0,frame.t-this.lastTime),cut=this.key!==shot.key||dt>1;
    this.lastTime=frame.t;this.key=shot.key;
    const cars=shot.ids.map(id=>poses.get(id)).filter(Boolean),aim=new THREE.Vector3(),position=new THREE.Vector3();
    if(shot.kind==='overview'||!cars.length){
      aim.copy(center);const radius=Math.max(...track.points.map(p=>Math.hypot(p[0]-center.x,p[1]-center.z)));
      const half=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect));
      const distance=radius/Math.sin(half)*1.05;
      position.copy(center).add(new THREE.Vector3(.30,.82,.49).normalize().multiplyScalar(distance));
    }else{
      for(const p of cars)aim.add(new THREE.Vector3(p[1],2,p[2]));aim.multiplyScalar(1/cars.length);
      const raw=cars[0][3];
      if(cut||this.heading===null)this.heading=raw;
      else this.heading+=Math.atan2(Math.sin(raw-this.heading),Math.cos(raw-this.heading))*(1-Math.exp(-dt/.3));
      const forward=new THREE.Vector3(Math.cos(this.heading),0,Math.sin(this.heading)),side=new THREE.Vector3(-forward.z,0,forward.x);
      const radius=Math.max(11,...cars.map(p=>Math.hypot(p[1]-aim.x,p[2]-aim.z)+11));
      const half=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect));
      const distance=Math.max(44,radius/Math.tan(half)*1.25);
      if(this.manualOrbit){
        const azimuth=this.heading+this.orbitAzimuth,horizontal=this.orbitDistance*Math.cos(this.orbitElevation);
        position.copy(aim).add(new THREE.Vector3(Math.cos(azimuth)*horizontal,this.orbitDistance*Math.sin(this.orbitElevation),Math.sin(azimuth)*horizontal));
      }else if(shot.angle==='trackside'&&shot.kind!=='grid'){
        const separation=this.anchor?Math.hypot(this.anchor.x-aim.x,this.anchor.z-aim.z):Infinity;
        if(cut||!this.anchor||separation>Math.max(170,distance*2)||separation<distance){
          // Elevated roadside cameras cut forward as the car leaves the shot.
          this.anchor=aim.clone().addScaledVector(forward,85).addScaledVector(side,Math.max(track.width/2+22,distance));this.anchor.y=32;
          this.position.copy(this.anchor);
        }
        position.copy(this.anchor);
      }else if(shot.angle==='aerial'||shot.kind==='grid')position.copy(aim).addScaledVector(forward,-distance*.35).addScaledVector(side,distance*.3).add(new THREE.Vector3(0,distance,0));
      else position.copy(aim).addScaledVector(forward,-distance).addScaledVector(side,distance*.18).add(new THREE.Vector3(0,distance*.48,0));
    }
    const blend=cut||this.orbitDirty?1:1-Math.exp(-dt/.14);this.orbitDirty=false;
    this.position.lerp(position,blend);this.aim.lerp(aim,blend);
    camera.position.copy(this.position);camera.lookAt(this.aim);
    return this.aim;
  }
}

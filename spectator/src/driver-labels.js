import * as THREE from 'three';
import {driverName} from './broadcast.js';

export class DriverLabels {
  constructor(world,roster){
    this.tags=new Map();this.enabled=true;
    for(const r of roster.filter(r=>!r.safety)){
      const canvas=document.createElement('canvas');canvas.width=384;canvas.height=112;
      const c=canvas.getContext('2d');c.fillStyle='#102027e8';c.beginPath();c.roundRect(2,2,380,88,12);c.fill();
      c.fillStyle='#'+r.colors[0].toString(16).padStart(6,'0');c.fillRect(12,16,8,58);
      c.fillStyle='#f6f7ef';c.font='600 60px sans-serif';c.textAlign='center';c.fillText(driverName(r),200,66,342);
      c.fillStyle='#e8f388';c.beginPath();c.moveTo(183,90);c.lineTo(201,90);c.lineTo(192,106);c.fill();
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const material=new THREE.SpriteMaterial({map:texture,depthTest:true,depthWrite:false,transparent:true,alphaTest:.05});
      const sprite=new THREE.Sprite(material);sprite.userData.carId=r.id;sprite.userData.driverTag=true;sprite.visible=false;sprite.renderOrder=4;
      world.add(sprite);this.tags.set(r.id,{sprite,roster:r});
    }
  }
  update(camera,poses,selected,onboard,overview){
    camera.updateMatrixWorld();const candidates=[];
    for(const[id,{sprite,roster}]of this.tags){
      const p=poses.get(id);if(!p){sprite.visible=false;continue;}
      sprite.position.set(p[1],roster.cls===5?9.8:7.2,p[2]);
      const distance=camera.position.distanceTo(sprite.position);
      sprite.visible=this.enabled&&!(onboard&&id===selected)&&distance<(overview?1400:400);
      const width=THREE.MathUtils.clamp(distance*.105,.5,38);sprite.scale.set(width,width*112/384,1);
      sprite.material.color.set(id===selected?0xe8f388:0xffffff);
      if(sprite.visible)candidates.push({id,sprite,distance,width});
    }
    const occupied=[];candidates.sort((a,b)=>(b.id===selected)-(a.id===selected)||a.distance-b.distance);
    for(const {sprite,width}of candidates){const point=sprite.position.clone().project(camera),depth=-sprite.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
      const h=width*112/384/Math.max(.1,depth)/Math.tan(camera.fov*Math.PI/360),w=h*384/112/camera.aspect;
      if(point.z<-1||point.z>1||Math.abs(point.x)>1.1||Math.abs(point.y)>1.05||occupied.some(r=>Math.abs(point.x-r.x)<(w+r.w)*.53&&Math.abs(point.y-r.y)<(h+r.h)*.6)){sprite.visible=false;continue;}
      occupied.push({x:point.x,y:point.y,w,h});
    }
  }
}

import * as THREE from 'three';

export class Atmosphere {
  constructor(world){
    this.group=new THREE.Group();world.add(this.group);this.flags=[];this.arms=[];this.enabled=true;
    const material=new THREE.MeshStandardMaterial({roughness:.9});
    this.armMesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(.5,.5,1,6),material,96);
    this.handMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(.25,8,6),material,48);
    for(const mesh of [this.armMesh,this.handMesh]){mesh.count=0;mesh.visible=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;this.group.add(mesh);}
    this.dummy=new THREE.Object3D();
  }
  waveArm(shoulder,elbow,hand,shirt,skin){
    if(this.arms.length>=48)return false;
    const pivot=new THREE.Object3D(),origin=new THREE.Vector3(...shoulder),index=this.arms.length;pivot.position.copy(origin);
    pivot.userData.elbow=new THREE.Vector3(...elbow).sub(origin);pivot.userData.hand=new THREE.Vector3(...hand).sub(origin);
    this.armMesh.setColorAt(index*2,new THREE.Color(shirt));this.armMesh.setColorAt(index*2+1,new THREE.Color(skin));this.handMesh.setColorAt(index,new THREE.Color(skin));
    this.armMesh.instanceColor.needsUpdate=true;this.handMesh.instanceColor.needsUpdate=true;
    this.arms.push(pivot);this.armMesh.count=this.arms.length*2;this.handMesh.count=this.arms.length;return true;
  }
  flag(x,y,z,heading,color,finish=false){
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,finish?4:10,6),new THREE.MeshStandardMaterial({color:0x889895,roughness:.6}));pole.position.set(x,y+(finish?2:5),z);this.group.add(pole);
    const geometry=new THREE.PlaneGeometry(finish?3:4.5,finish?2:2.7,12,6);geometry.translate(finish?1.5:2.25,0,0);
    const material=new THREE.MeshStandardMaterial({color,roughness:.9,side:THREE.DoubleSide});
    if(finish){const data=new Uint8Array(8*8*4);for(let row=0;row<8;row++)for(let col=0;col<8;col++){const offset=(row*8+col)*4,c=(row+col)%2?235:28;data.set([c,c,c,255],offset);}const tex=new THREE.DataTexture(data,8,8);tex.needsUpdate=true;tex.magFilter=THREE.NearestFilter;material.map=tex;}
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y+(finish?3.5:9),z);mesh.rotation.y=-heading;mesh.visible=!finish;this.group.add(mesh);this.flags.push({mesh,finish,base:geometry.attributes.position.array.slice()});
    if(finish){const torso=new THREE.Mesh(new THREE.CylinderGeometry(.55,.65,1.6,8),new THREE.MeshStandardMaterial({color:0xe17c30}));torso.position.set(x-.6,y+.9,z);this.group.add(torso);const head=new THREE.Mesh(new THREE.SphereGeometry(.42,10,8),new THREE.MeshStandardMaterial({color:0xe1b48a}));head.position.set(x-.6,y+2.1,z);this.group.add(head);}
  }
  update(frame){if(!frame)return;this.armMesh.visible=true;this.handMesh.visible=true;const t=this.enabled?frame.t:0,wind=frame.weather===4?2:frame.weather===3?1.4:1;
    for(const {mesh,finish,base}of this.flags){mesh.visible=!finish||frame.phase>=2;const a=mesh.geometry.attributes.position;
      for(let i=0;i<a.count;i++){const x=base[i*3];a.setZ(i,Math.sin(x*1.4-t*3*wind+mesh.position.x)*.28*x/4.5);}
      a.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
    for(let i=0;i<this.arms.length;i++){
      const arm=this.arms[i],near=frame.cars.some(p=>Math.hypot(p[1]-arm.position.x,p[2]-arm.position.z)<85);arm.rotation.z=this.enabled?Math.sin(t*(near?4:1.1)+i)* (near?.24:.05):0;
      arm.updateMatrix();const elbow=arm.userData.elbow.clone().applyMatrix4(arm.matrix),hand=arm.userData.hand.clone().applyMatrix4(arm.matrix);
      for(const [part,a,b,width]of [[0,arm.position,elbow,.55],[1,elbow,hand,.38]]){
        const delta=b.clone().sub(a);this.dummy.position.copy(a).add(b).multiplyScalar(.5);this.dummy.scale.set(width,delta.length(),width);this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());this.dummy.updateMatrix();this.armMesh.setMatrixAt(i*2+part,this.dummy.matrix);
      }
      this.dummy.position.copy(hand);this.dummy.quaternion.identity();this.dummy.scale.setScalar(1);this.dummy.updateMatrix();this.handMesh.setMatrixAt(i,this.dummy.matrix);
    }
    this.armMesh.instanceMatrix.needsUpdate=true;this.handMesh.instanceMatrix.needsUpdate=true;
  }
}

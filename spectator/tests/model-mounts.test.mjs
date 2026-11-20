import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCar} from '../src/models.js';
import {onboardMount} from '../src/onboard.js';

// Canvas text isn't part of these geometric checks; no WebGL context is needed.
globalThis.document={createElement:()=>({width:128,height:96,getContext:()=>({fillRect(){},fillText(){}})})};
const sizes=[[14,5.8],[14.5,6.4],[13.5,6.2],[12.5,5.8],[12.5,4.8],[14.5,6.8],[8.5,3.2],[7,5]];
for(let cls=0;cls<8;cls++)test(`class ${cls}: exposed lamp lenses and housings supported by bodywork`,()=>{
  const [len,wid]=sizes[cls],model=createCar({cls,len,wid,id:cls,num:12,colors:[0x336677,0xeeeeee,0x222222]});
  model.updateMatrixWorld(true);
  const lights=model.userData.lights.userData,meshes=[],body=model.children.filter(o=>o.isMesh);
  model.traverse(o=>{if(o.isMesh&&!o.material.isShaderMaterial)meshes.push(o);});
  for(const m of lights.mounts){
    const head=m.kind==='head',sign=head?1:-1;
    const y=m.y+(!m.round&&head?-m.height*.03:!head&&cls===5?-m.height*.25:0);
    const z=m.z+(!m.round&&head?m.width*.24:0);
    const ray=new THREE.Raycaster(new THREE.Vector3(m.x+sign*2,y,z),new THREE.Vector3(-sign,0,0));
    const hit=ray.intersectObjects(meshes,false)[0];
    assert.equal(hit?.object.material,head?lights.headMat:lights.tailMat,`${m.kind} lens is obscured at ${m.x},${y},${z}`);
    if(m.anchor){
      ray.set(new THREE.Vector3(m.anchor[0],m.anchor[1]+1,m.anchor[2]),new THREE.Vector3(0,-1,0));
      const contact=ray.intersectObjects(body,false)[0];
      assert.ok(contact&&contact.distance<=1.02,`${m.kind} bracket misses the body`);
    }else{
      ray.set(new THREE.Vector3(m.x+sign*.5,m.y,m.z),new THREE.Vector3(-sign,0,0));
      const contact=ray.intersectObjects(body,false)[0];
      assert.ok(contact&&contact.distance<=.64,`${m.kind} housing floats off the end cap: ${contact?.distance}`);
    }
  }
  for(const angle of ['roof','bonnet','bumper','rear']){
    const mount=onboardMount({cls,len,wid},angle),ray=new THREE.Raycaster(new THREE.Vector3(mount.x,mount.y,0),new THREE.Vector3(mount.reverse?-1:1,0,0));
    assert.equal(ray.intersectObjects(meshes,false).length,0,`${angle} camera looks through its own bodywork`);
  }
  const geometries=new Set(),materials=new Set();model.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>{m.map?.dispose();m.dispose();});
});

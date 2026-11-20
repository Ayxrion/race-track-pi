import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCar, animateCar } from '../src/models.js';
import { validMessage } from '../shared/protocol.mjs';
import { manifest } from './fixtures.mjs';

globalThis.document={createElement:()=>({width:128,height:96,getContext:()=>({fillRect(){},fillText(){}})})};
for(const [cls,len,wid,count] of [[6,8.5,3.2,2],[7,7,5,4]]){
  test(`class ${cls}: correct wheel layout, ground contact, finite geometry and frozen animation`,()=>{
    const model=createCar({id:0,num:27,cls,len,wid,colors:[0xdd4433,0xeeeeee,0x343d45]});
    const {wheels}=model.userData;
    assert.equal(wheels.length,count);
    assert.equal(wheels.filter(w=>w.front).length,count/2);
    assert.ok(wheels.every(w=>cls===6?w.pivot.position.z===0:Math.abs(w.pivot.position.z)===2));
    model.updateMatrixWorld(true);
    // Curved fairings must not swallow the race-number decals.
    const bodyMeshes=[];model.traverse(o=>{if(o.isMesh&&!o.material.isShaderMaterial)bodyMeshes.push(o);});
    for(const mesh of bodyMeshes.filter(o=>o.material.map?.isCanvasTexture)){
      const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
      for(let i=0;i<p.count;i+=6){
        const center=new THREE.Vector3().fromBufferAttribute(p,i).add(new THREE.Vector3().fromBufferAttribute(p,i+1)).add(new THREE.Vector3().fromBufferAttribute(p,i+2)).divideScalar(3);
        const normal=new THREE.Vector3().fromBufferAttribute(n,i).normalize();
        const ray=new THREE.Raycaster(center.clone().addScaledVector(normal,.35),normal.clone().negate());
        assert.equal(ray.intersectObjects(bodyMeshes,false)[0]?.object.material,mesh.material,'number decal must remain exposed');
      }
    }
    for(const wheel of wheels){
      const bounds=new THREE.Box3().setFromObject(wheel.axle);
      assert.ok(Math.abs(bounds.min.y)<.02,'tire touches the ground');
    }
    let triangles=0;
    model.traverse(o=>{if(o.geometry){const p=o.geometry.attributes.position;assert.ok([...p.array].every(Number.isFinite));triangles+=(o.geometry.index?.count??p.count)/3;}});
    assert.ok(triangles<65000,'bounded complexity for a full grid');
    const pose=[0,0,0,0,20];animateCar(model,pose,0);animateCar(model,[0,2,0,.10,20],.1);
    assert.ok(wheels.every(w=>Math.abs(w.axle.rotation.z)>.01));
    assert.ok(wheels.filter(w=>w.front).every(w=>Math.abs(w.pivot.rotation.y)>.01));
    assert.ok(wheels.filter(w=>!w.front).every(w=>w.pivot.rotation.y===0));
    const rotations=wheels.map(w=>[w.axle.rotation.z,w.pivot.rotation.y]);
    animateCar(model,[0,2,0,.10,20],.1);
    assert.deepEqual(wheels.map(w=>[w.axle.rotation.z,w.pivot.rotation.y]),rotations);
    const geometries=new Set(),materials=new Set();model.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>{m.map?.dispose();m.dispose();});
  });
}
test('v1 manifests accept both Pi vehicle classes and still reject unknown classes',()=>{
  for(const cls of [6,7]){
    const m=structuredClone(manifest);Object.assign(m.roster[0],{cls,len:cls===6?8.5:7,wid:cls===6?3.2:5});
    assert.equal(validMessage(m),true);
  }
  const m=structuredClone(manifest);m.roster[0].cls=8;assert.equal(validMessage(m),false);
});

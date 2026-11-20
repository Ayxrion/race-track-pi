import test from 'node:test';
import assert from 'node:assert/strict';
import {createVehicleLights,updateVehicleLights} from '../src/car-lights.js';

for(let cls=0;cls<8;cls++)test(`class ${cls}: headlights follow night; braking brightens red lamps in day and night`,()=>{
  const lights=createVehicleLights({cls,len:cls===6?8.5:cls===7?7:14,wid:cls===6?3.2:cls===7?5:6}),d=lights.userData;
  assert.equal(d.beams.visible,false);assert.equal(d.headMat.emissiveIntensity,0);
  updateVehicleLights(lights,.299,false);assert.equal(d.beams.visible,false);
  updateVehicleLights(lights,.3,false);assert.equal(d.beams.visible,true);
  assert.ok(d.headMat.emissiveIntensity>0);const tail=d.tailMat.emissiveIntensity;
  updateVehicleLights(lights,1,true);assert.ok(d.tailMat.emissiveIntensity>tail);
  assert.ok(d.tailMat.emissive.r>d.tailMat.emissive.g*10);
  const brake=d.tailMat.emissiveIntensity;
  updateVehicleLights(lights,0,true);assert.equal(d.tailMat.emissiveIntensity,brake);
  assert.equal(d.beams.visible,false);assert.equal(d.tails.visible,true);
  updateVehicleLights(lights,0,false);assert.equal(d.tailMat.emissiveIntensity,0);assert.equal(d.spills.visible,false);
  lights.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

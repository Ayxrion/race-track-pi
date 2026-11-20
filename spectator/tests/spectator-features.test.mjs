import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {onboardMount,updateOnboard} from '../src/onboard.js';
import {broadcastState} from '../src/broadcast.js';
import {sprayAmount,weatherIntensity,WeatherEffects} from '../src/weather-effects.js';
import {Atmosphere} from '../src/atmosphere.js';

test('onboard cameras remain rigidly attached through heading wrap, stopping and reverse view',()=>{
  const camera=new THREE.PerspectiveCamera(),r={len:14,wid:6,cls:0},p=[0,50,30,Math.PI-.001];
  for(const angle of ['roof','bonnet','bumper','rear']){
    updateOnboard(camera,p,r,angle);const before=camera.position.clone();
    updateOnboard(camera,[0,50,30,-Math.PI+.001],r,angle);assert.ok(camera.position.distanceTo(before)<.02);
    const same=camera.position.clone();updateOnboard(camera,[0,50,30,-Math.PI+.001],r,angle);assert.ok(camera.position.equals(same));
    updateOnboard(camera,[0,60,35,0],r,angle);assert.equal(camera.position.x,60+onboardMount(r,angle).x);
    const direction=new THREE.Vector3();camera.getWorldDirection(direction);assert.ok(angle==='rear'?direction.x<-.99:direction.x>.99);
  }
});

const manifest={roster:[{id:0,code:'ONE',num:12},{id:1,code:'TWO',num:9},{id:2,code:'SC',safety:true}]};
const pose=(id,flags={})=>Object.assign([id,0,0,0,30,2,0,false,false,0,false,false,1.2],flags);
const frame={phase:1,lap:3,laps:5,series:'Touring',event:'Safety car deployed',order:[1,0,2],cars:[pose(0),pose(1),pose(2)]};
test('broadcast follows official order and race phase without declaring a premature winner',()=>{
  const state=broadcastState(frame,manifest,0);assert.equal(state.leader.name,'TWO');assert.equal(state.driver.position,2);assert.equal(state.event,frame.event);assert.equal(state.rows.length,2);
  assert.equal(broadcastState({...frame,phase:0},manifest).phase,'STARTING GRID');
  assert.equal(broadcastState({...frame,phase:2},manifest).headline,'The field takes the flag');
  assert.equal(broadcastState({...frame,phase:3},manifest).classification,true);
  assert.equal(broadcastState({...frame,lap:5},manifest).headline,'Final lap');
});
test('broadcast distinguishes retirement, pits, finished status, lapped traffic and unavailable selections',()=>{
  for(const [flags,label]of [[{7:true},'Retired'],[{6:1},'In pit lane'],[{11:true},'Finished'],[{12:-2},'2 lap behind']]){
    assert.equal(broadcastState({...frame,cars:[pose(0,flags),pose(1)]},manifest,0).driver.status,label);
  }
  assert.equal(broadcastState(frame,manifest,99).driver,undefined);
  assert.equal(broadcastState({...frame,event:''},manifest).event,'');
});
test('precipitation follows weather codes and spray requires wet ground and a moving car',()=>{
  assert.equal(weatherIntensity(0),0);assert.equal(weatherIntensity(6),0);assert.ok(weatherIntensity(4)>weatherIntensity(3));assert.ok(weatherIntensity(5)>0);
  assert.equal(sprayAmount(pose(0),0),0);assert.equal(sprayAmount(pose(0,{4:0}),1),0);assert.equal(sprayAmount(pose(0,{7:true}),1),0);assert.ok(sprayAmount(pose(0),.8)>0);
});

test('weather pools stay bounded, freeze at the displayed timestamp, and clear in dry weather',()=>{
  const world=new THREE.Group(),track={L:400,width:24,stands:[]},effects=new WeatherEffects(world,track,(s,d)=>({x:s,z:d,h:0}));
  const camera=new THREE.PerspectiveCamera(),cars=Array.from({length:21},(_,i)=>pose(i,{4:100})),roster=new Map(cars.map(p=>[p[0],{len:14,wid:6}]));
  const f={cars,weather:4,wet:1,t:12,night:.5};effects.update(f,camera,roster);
  assert.equal(effects.spray.geometry.drawRange.count,21*36);assert.ok(effects.sprayPositions.every(Number.isFinite));
  const before=effects.sprayPositions.slice();effects.update(f,camera,roster);assert.deepEqual(effects.sprayPositions,before);
  effects.update({...f,wet:0,weather:0},camera,roster);assert.equal(effects.spray.geometry.drawRange.count,0);assert.equal(effects.rain.visible,false);assert.equal(effects.snow.visible,false);assert.equal(effects.puddles.visible,false);
  effects.enabled=false;effects.update(f,camera,roster);assert.equal(effects.group.visible,false);
});

test('crowd and flag animation freezes with playback; chequered flags only appear at the finish',()=>{
  const atmosphere=new Atmosphere(new THREE.Group());atmosphere.flag(0,0,0,0,0xffffff,true);atmosphere.waveArm([0,2,0],[0,3,0],[0,4,0],0xff0000,0xffccaa);
  const f={t:5,weather:4,cars:[pose(0)],phase:1};atmosphere.update(f);assert.equal(atmosphere.flags[0].mesh.visible,false);
  const before=atmosphere.flags[0].mesh.geometry.attributes.position.array.slice(),angle=atmosphere.arms[0].rotation.z;
  atmosphere.update(f);assert.deepEqual(atmosphere.flags[0].mesh.geometry.attributes.position.array,before);assert.equal(atmosphere.arms[0].rotation.z,angle);
  atmosphere.update({...f,phase:2});assert.equal(atmosphere.flags[0].mesh.visible,true);
  atmosphere.enabled=false;atmosphere.update({...f,t:8});assert.equal(atmosphere.arms[0].rotation.z,0);
});

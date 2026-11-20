import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {TVDirector,findBattle} from '../src/director.js';
import {TVCamera} from '../src/tv-camera.js';
import {manifest} from './fixtures.mjs';

const race={...manifest,roster:[0,1,2].map(id=>({...manifest.roster[0],id,num:id+1,code:['ARD','BEL','CRN'][id]}))};
const car=(id,x,z=0,h=0,lap=0)=>[id,x,z,h,30,lap,0,false,false,0,false,false,0];
const frame=(t=0,cars=[car(0,50),car(1,30),car(2,5)],phase=1,order=[0,1,2])=>({t,cars,phase,order});

test('leader coverage switches with the official order; driver coverage remains pinned',()=>{
  const d=new TVDirector(race);d.configure('leader');assert.deepEqual(d.update(frame()).ids,[0]);
  assert.deepEqual(d.update(frame(1,undefined,1,[1,0,2])).ids,[1]);
  d.configure('driver',2);assert.deepEqual(d.update(frame(2,undefined,1,[1,0,2])).ids,[2]);
  const missing=d.update(frame(3,[car(0,60),car(1,40)]));assert.deepEqual(missing.ids,[0]);assert.match(missing.label,/unavailable/);
});
test('closest battle follows adjacent places on circuit, not nearby roads or lapped traffic',()=>{
  assert.deepEqual(findBattle(frame(),race.track).ids,[1,0]);
  assert.equal(findBattle(frame(0,[car(0,50,0,0,1),car(1,49)]),race.track),null);
  // Physically near on opposite sides of a hairpin, over 45 units apart on track.
  assert.equal(findBattle(frame(0,[car(0,70,100,Math.PI),car(1,70,0)]),race.track),null);
  const retired=car(0,50);retired[7]=true;const pit=car(1,30);pit[6]=1;
  assert.equal(findBattle(frame(0,[retired,pit,car(2,5)]),race.track),null);
  // Battle straddling the lap line (front has just incremented its lap).
  assert.deepEqual(findBattle(frame(0,[car(0,5,0,0,1),car(1,0,5,-Math.PI/2)]),race.track).ids,[1,0]);
});
test('battle coverage holds a shot, reacquires, and falls back honestly when spread out',()=>{
  const d=new TVDirector(race);d.configure('battle');const first=d.update(frame());
  assert.deepEqual(first.ids,[1,0]);assert.equal(d.update(frame(.2)).key,first.key);
  const spread=[car(0,0,90,-Math.PI/2),car(1,90,0),car(2,5)];
  const fallback=d.update(frame(6,spread));assert.equal(fallback.kind,'leader');assert.match(fallback.label,/No close battle/);
  const recovery=d.update(frame(12));assert.equal(recovery.kind,'battle');
});
test('auto director cycles shots, freezes its schedule with playback, handles finish and grid',()=>{
  const d=new TVDirector(race);const first=d.update(frame());assert.equal(first.kind,'leader');
  for(let i=0;i<200;i++)assert.equal(d.update(frame()).key,first.key);
  d.next();assert.equal(d.update(frame()).kind,'battle');d.next();const driver=d.update(frame());assert.equal(driver.kind,'driver');assert.notEqual(driver.ids[0],0);
  d.next();assert.equal(d.update(frame()).kind,'overview');
  assert.equal(d.update(frame(1,undefined,0)).kind,'grid');assert.equal(d.update(frame(2)).kind,'leader');
  const finished=car(0,50);finished[11]=true;const end=d.update(frame(3,[finished,car(1,30)],2));
  assert.equal(end.kind,'leader');assert.equal(d.update(frame(3.1,[finished,car(1,30)],2)).key,end.key);
  assert.equal(d.update(frame(4,undefined,3)).kind,'overview');
});
test('a suspended or reset timeline starts a fresh shot without old targets',()=>{
  const d=new TVDirector(race);d.update(frame());d.next();d.update(frame(1));
  assert.equal(d.update(frame(10)).kind,'leader');assert.equal(d.update(frame(0)).kind,'leader');
});
test('broadcast camera frames both battle cars on wide and narrow displays',()=>{
  for(const aspect of [16/9,390/844])for(const angle of ['chase','aerial','trackside']){
    const camera=new THREE.PerspectiveCamera(60,aspect,.5,3200),rig=new TVCamera(),f=frame(1),poses=new Map(f.cars.map(p=>[p[0],p]));
    rig.update(camera,{key:'battle',kind:'battle',ids:[0,1],angle},poses,f,new THREE.Vector3(50,0,50),race.track);
    camera.updateMatrixWorld();
    for(const id of [0,1]){const p=poses.get(id),screen=new THREE.Vector3(p[1],2,p[2]).project(camera);assert.ok(Math.abs(screen.x)<.8&&Math.abs(screen.y)<.8&&screen.z<1);}
    const before=camera.position.clone();rig.update(camera,{key:'battle',kind:'battle',ids:[0,1],angle},poses,f,new THREE.Vector3(50,0,50),race.track);assert.ok(before.equals(camera.position));
  }
});

test('trackside cameras cut away before cars get too close to the lens',()=>{
  const camera=new THREE.PerspectiveCamera(60,16/9,.5,3200),rig=new TVCamera(),shot={key:'fixed',kind:'battle',ids:[0,1],angle:'trackside'},center=new THREE.Vector3(50,0,50);
  let f=frame(1),poses=new Map(f.cars.map(p=>[p[0],p]));rig.update(camera,shot,poses,f,center,race.track);
  const old=rig.anchor.clone();
  f=frame(1.1,[car(0,old.x+10,old.z),car(1,old.x-10,old.z)]);poses=new Map(f.cars.map(p=>[p[0],p]));
  rig.update(camera,shot,poses,f,center,race.track);assert.ok(rig.anchor.distanceTo(old)>50);
});

test('manual orbit works with frozen telemetry, stays on a moving leader, and resets',()=>{
  const camera=new THREE.PerspectiveCamera(60,16/9,.5,3200),rig=new TVCamera(),center=new THREE.Vector3(50,0,50),shot={key:'leader',kind:'leader',ids:[0],angle:'chase'};
  const first=frame(1),poses=new Map(first.cars.map(p=>[p[0],p]));rig.update(camera,shot,poses,first,center,race.track);
  const before=camera.position.clone();rig.orbitBy(180,-35);rig.update(camera,shot,poses,first,center,race.track);
  assert.ok(before.distanceTo(camera.position)>20);assert.ok(camera.position.y>2);
  const far=camera.position.distanceTo(rig.aim);rig.zoomBy(-300);rig.update(camera,shot,poses,first,center,race.track);assert.ok(camera.position.distanceTo(rig.aim)<far);
  const moved=frame(1.1,[car(0,53),car(1,33)]);rig.update(camera,shot,new Map(moved.cars.map(p=>[p[0],p])),moved,center,race.track);
  assert.ok(rig.aim.x>50);assert.equal(rig.manualOrbit,true);
  rig.reset();rig.update(camera,shot,poses,first,center,race.track);assert.equal(rig.manualOrbit,false);assert.ok(camera.position.distanceTo(before)<1e-8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraInput} from '../src/camera-input.js';
const event=(id,x,y=0)=>({pointerId:id,clientX:x,clientY:y,button:0});
function setup(t,customZoom=()=>true){
  const original=globalThis.window;globalThis.window={addEventListener(){}};
  t.after(()=>{if(original===undefined)delete globalThis.window;else globalThis.window=original;});
  const picks=[],drags=[],zooms=[];
  const input=new CameraInput({addEventListener(){},setPointerCapture(){}},{pick:(...p)=>picks.push(p),drag:(...p)=>drags.push(p),zoom:d=>zooms.push(d),customZoom});
  return {input,picks,drags,zooms};
}
test('a tap picks a car while a drag does not',t=>{
  const {input,picks,drags}=setup(t);
  input.down(event(1,10));input.up(event(1,10));assert.deepEqual(picks,[[10,0]]);
  input.down(event(2,10));input.move(event(2,40,5));input.up(event(2,40,5));
  assert.equal(picks.length,1);assert.deepEqual(drags,[[30,5]]);
});
test('pinch zoom never picks a car or jumps into a drag when one finger lifts',t=>{
  const {input,picks,drags,zooms}=setup(t);
  input.down(event(1,10));input.down(event(2,110));input.move(event(2,150));
  assert.ok(zooms[0]<0,'spreading fingers zooms in');
  input.up(event(2,150));input.move(event(1,30));input.up(event(1,30));
  assert.equal(picks.length,0);assert.equal(drags.length,0);
  input.down(event(3,20));input.up(event(3,20));assert.equal(picks.length,1);
});
test('overview delegates zoom to OrbitControls and cancelled pointers never select',t=>{
  const {input,picks,zooms}=setup(t,()=>false);
  input.down(event(1,0));input.down(event(2,80));input.move(event(2,120));
  input.up(event(1,0),true);input.up(event(2,120),true);
  input.down(event(3,10));input.up(event(3,10),true);
  assert.equal(zooms.length,0);assert.equal(picks.length,0);assert.equal(input.points.size,0);
});

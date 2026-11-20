import test from 'node:test';
import assert from 'node:assert/strict';
import { CarMotion } from '../src/car-motion.js';

const pose = (x, z=0, heading=0, speed=20) => [0,x,z,heading,speed];
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);

test('wheels roll by distance/radius, stop with frozen poses and reverse correctly',()=>{
  const motion=new CarMotion(2,8,14);
  motion.update(pose(0),0);motion.update(pose(2),.1);near(motion.spin,-1);
  motion.update(pose(2),.1);motion.update(pose(2),.2);near(motion.spin,-1);
  motion.update(pose(0),.3);near(motion.spin,0);
  motion.update(pose(0,2),.4);near(motion.spin,0); // Sideways slide isn't rolling.
});

test('wheel rotation is independent of render frame rate',()=>{
  const run=hz=>{const m=new CarMotion(1.2,8,14);for(let i=0;i<=hz;i++)m.update(pose(i*20/hz),i/hz);return m.spin;};
  near(run(30),run(60));near(run(60),run(144));
});

test('front wheels steer through the heading seam without a full-turn jump',()=>{
  const m=new CarMotion(2,8,14);
  m.update(pose(0,0,Math.PI-.01),0);
  m.update(pose(-2,0,-Math.PI+.01),.1);
  assert.ok(m.steer<0&&m.steer>-.1);
  const steer=m.steer;m.update(pose(-2,0,-Math.PI+.01),.2);near(m.steer,steer);
  m.update(pose(-4,0,-Math.PI+.01),.3);assert.ok(Math.abs(m.steer)<Math.abs(steer));
});

test('teleports, suspended playback and returning cars rebase without a wheel burst',()=>{
  const m=new CarMotion(2,8,14);
  m.update(pose(0),0);m.update(pose(2),.1);
  const spin=m.spin;
  m.update(pose(1000),.2);near(m.spin,spin);
  m.update(pose(1020),5);near(m.spin,spin);
  m.update(pose(1022),5.1);near(m.spin,spin-1);
  m.reset();m.update(pose(5000),8);near(m.spin,spin-1);
  m.update(pose(0),0);near(m.spin,spin-1);
});

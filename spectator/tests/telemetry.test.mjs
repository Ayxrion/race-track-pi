import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PoseBuffer,relaySocketUrl } from '../src/telemetry.js';
import { validMessage,frameMatchesManifest } from '../shared/protocol.mjs';
import { manifest,frame } from './fixtures.mjs';

test('interpolates positions and headings across the ±pi seam without inventing laps',()=>{const b=new PoseBuffer(50);b.reset('test-boot/1');const a=frame(1,0),c=frame(2,.1);a.cars[0][3]=Math.PI-.1;c.cars[0][3]=-Math.PI+.1;c.lap=2;b.push(a,0);b.push(c,100);const result=b.sample(100);assert.equal(result.cars[0][1],15);assert.ok(Math.abs(result.cars[0][3]-Math.PI)<.001);assert.equal(result.lap,1);});
test('stale input freezes at the last real pose and history is bounded',()=>{const b=new PoseBuffer();b.reset('test-boot/1');for(let i=1;i<100;i++)b.push(frame(i),i*100);assert.equal(b.frames.length,64);assert.equal(b.sample(100000).cars[0][1],990);assert.equal(b.stale(13000),true);});

const movingFrame = (seq, t) => {
  const f = frame(seq, t);
  f.cars[0][1] = t * 100;
  return f;
};

test('jittery 7 Hz delivery stays smooth at 60 Hz without moving the playback clock backwards', () => {
  const b = new PoseBuffer(); b.reset('test-boot/1');
  const packets = Array.from({length: 80}, (_, i) => ({
    t: i / 7, arrival: i * 1000 / 7 + [30, 50, 170, 50, 10, 10, 50][i % 7], seq: i + 1,
  }));
  // TCP preserves order even when one packet is late and the next is close behind.
  for (let i = 1; i < packets.length; i++) packets[i].arrival = Math.max(packets[i].arrival, packets[i-1].arrival + 1);
  let next = 0, previous, backwards = 0, freezes = 0, maxStep = 0;
  for (let now = 0; now < 10000; now += 1000 / 60) {
    while (next < packets.length && packets[next].arrival <= now) {
      const p = packets[next++]; b.push(movingFrame(p.seq, p.t), p.arrival);
    }
    const sample = b.sample(now);
    if (!sample) continue;
    if (previous && now > 1500) {
      const step = sample.cars[0][1] - previous.cars[0][1];
      if (step < -1e-8) backwards++;
      if (Math.abs(step) < 1e-8) freezes++;
      maxStep = Math.max(maxStep, step);
    }
    previous = sample;
  }
  assert.equal(backwards, 0);
  assert.equal(freezes, 0);
  assert.ok(maxStep <= 100 / 60 * 1.061, `unexpected position jump: ${maxStep}`);
});

test('a delayed packet cannot change the sampled position at the same render time', () => {
  const b = new PoseBuffer(); b.reset('test-boot/1');
  for (let i = 0; i <= 20; i++) { b.push(movingFrame(i + 1, i / 10), i * 100); b.sample(i * 100); }
  const before = b.sample(2250);
  b.push(movingFrame(22, 2.1), 2250);
  const after = b.sample(2250);
  assert.equal(after.cars[0][1], before.cars[0][1]);
});

test('recorded ESP32 delivery timing plays continuously without packet-driven position jumps', () => {
  // Relative [browser arrival milliseconds, device simulation seconds], no credentials or poses.
  const arrivals = JSON.parse(readFileSync(new URL('./fixtures/live-arrivals.json', import.meta.url)));
  const b = new PoseBuffer(); b.reset('test-boot/1');
  let next = 0, previous;
  for (let now = 0; now < arrivals.at(-1)[0]; now += 1000 / 60) {
    while (next < arrivals.length && arrivals[next][0] <= now) {
      const [arrival, time] = arrivals[next++]; b.push(movingFrame(next, time), arrival);
    }
    const sample = b.sample(now);
    if (!sample) continue;
    const x = sample.cars[0][1];
    if (previous !== undefined && now > 2500) {
      assert.ok(x > previous, `playback stopped or reversed at ${now} ms`);
      assert.ok(x - previous <= 100 / 60 * 1.061, `playback jumped at ${now} ms`);
    }
    previous = x;
  }
});

test('outages freeze real poses, then rebuffer the new live segment without extrapolating', () => {
  const b = new PoseBuffer(); b.reset('test-boot/1');
  b.push(movingFrame(1, 0), 0); b.push(movingFrame(2, .5), 500);
  b.sample(500);
  assert.equal(b.sample(4000).cars[0][1], 50);
  b.push(movingFrame(3, 4), 4100);
  assert.equal(b.frames.length, 1);
  assert.equal(b.sample(4100).cars[0][1], 400);
  assert.equal(b.sample(4250).cars[0][1], 400);
  b.push(movingFrame(4, 4.5), 4600);
  const resumed = b.sample(4600);
  assert.ok(resumed.cars[0][1] >= 400 && resumed.cars[0][1] <= 450);
});

test('a race change resets the playback clock as well as its pose history', () => {
  const b = new PoseBuffer(); b.reset('test-boot/1');
  b.push(movingFrame(1, 100), 0); b.sample(0);
  b.reset('test-boot/2'); b.push({...movingFrame(1, 0), race:2}, 10);
  assert.equal(b.sample(10).cars[0][1], 0);
});
test('rejects out-of-order and previous-race frames, accepts new sequence after reset',()=>{const b=new PoseBuffer();b.reset('test-boot/1');assert.equal(b.push(frame(2),100),true);assert.equal(b.push(frame(1),200),false);assert.equal(b.push({...frame(3),race:2},300),false);b.reset('new-boot/1');assert.equal(b.push({...frame(1),session:'new-boot'},400),true);assert.equal(b.frames.length,1);});
test('network URLs enforce secure connections from HTTPS and strip unrelated paths',()=>{assert.equal(relaySocketUrl('https://race.ayxie.com/foo?q=a',true),'wss://race.ayxie.com/watch');assert.throws(()=>relaySocketUrl('http://example.com',true));assert.throws(()=>relaySocketUrl('https://secret@example.com'));assert.throws(()=>relaySocketUrl('file:///tmp'));});
test('protocol bounds invalid geometry and rejects foreign car IDs',()=>{assert.ok(validMessage(manifest));assert.ok(validMessage(frame()));assert.equal(validMessage({...manifest,track:{...manifest.track,ds:1}}),false);const broken=structuredClone(manifest);broken.track.points[0][0]=NaN;assert.equal(validMessage(broken),false);const foreign=frame();foreign.cars[0][0]=19;assert.equal(frameMatchesManifest(foreign,manifest),false);});

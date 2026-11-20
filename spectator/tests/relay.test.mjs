import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createRelay } from '../relay/server.mjs';
import { manifest,frame } from './fixtures.mjs';

test('authenticated publishing, two independent viewers, race changes and reconnect bootstrap',{timeout:10000},async(t)=>{
  let now=100000;const token='test-only-publishing-token-32-characters';const relay=createRelay({token,clock:()=>now});
  relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');t.after(()=>relay.close());
  const port=relay.server.address().port,url=`http://127.0.0.1:${port}`;
  async function publish(m,secret=token){now+=100;return fetch(url+'/api/publish',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(m)});}
  assert.equal((await publish(manifest,'wrong')).status,401);
  assert.equal((await publish(frame())).status,409);
  assert.equal((await publish(manifest)).status,200);
  const a=new WebSocket(`ws://127.0.0.1:${port}/watch`),b=new WebSocket(`ws://127.0.0.1:${port}/watch`);const ma=[],mb=[];
  a.on('message',x=>ma.push(JSON.parse(x)));b.on('message',x=>mb.push(JSON.parse(x)));await Promise.all([once(a,'open'),once(b,'open')]);
  const received=new Promise(resolve=>b.on('message',x=>{if(JSON.parse(x).type==='frame')resolve();}));
  assert.equal((await publish(frame())).status,200);await received;
  assert.equal(ma.find(m=>m.type==='manifest').track.name,'Test circuit');assert.equal(mb.at(-1).seq,1);assert.equal(ma.at(-1).cars[0][1],10);
  assert.equal((await publish(frame())).status,409);
  const invalid=frame(2);invalid.cars[0][0]=20;assert.equal((await publish(invalid)).status,409);
  assert.equal((await publish({...manifest,race:2})).status,200);
  assert.equal((await publish(frame(2))).status,409);
  assert.equal((await publish({...frame(1),race:2})).status,200);
  const c=new WebSocket(`ws://127.0.0.1:${port}/watch`),mc=[];await new Promise(resolve=>c.on('message',x=>{const m=JSON.parse(x);mc.push(m);if(m.type==='frame')resolve();}));
  assert.equal(mc.find(m=>m.type==='manifest').race,2);assert.equal(mc.at(-1).seq,1);
  now+=4000;assert.equal((await(await fetch(url+'/health')).json()).deviceOnline,false);
  const closed=once(c,'close');c.send('change race');await closed;assert.equal(c.readyState,WebSocket.CLOSED);
});

test('relay refuses missing or short publishing keys',()=>{assert.throws(()=>createRelay({token:''}));assert.throws(()=>createRelay({token:'abc'}));});

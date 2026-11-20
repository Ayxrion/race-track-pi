import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createRelay } from '../relay/server.mjs';
import { manifest, frame } from './fixtures.mjs';
import { sourceFromSearch } from '../shared/sources.mjs';
import { relaySocketUrl, LiveFeed } from '../src/telemetry.js';

const token='esp32-test-publishing-key-at-least-32-chars';
const piToken='pi-test-publishing-key-different-32-chars';

test('source links default to ESP32 and Pi uses its own subscription',()=>{
  assert.equal(sourceFromSearch(''),'esp32');
  assert.equal(sourceFromSearch('?source=pi'),'pi');
  assert.equal(sourceFromSearch('?source=constructor'),'esp32');
  assert.equal(relaySocketUrl('https://race.ayxie.com?source=esp32',true,'pi'),'wss://race.ayxie.com/watch?source=pi');
  assert.equal(relaySocketUrl('https://race.ayxie.com?source=pi',true,'esp32'),'wss://race.ayxie.com/watch');
  assert.throws(()=>relaySocketUrl('https://race.ayxie.com',true,'unknown'));
});

test('two sources isolate credentials, rate limits, races, sequence numbers and reconnect snapshots',{timeout:10000},async t=>{
  let now=100000;
  const relay=createRelay({token,piToken,clock:()=>now});
  relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');t.after(()=>relay.close());
  const base=`http://127.0.0.1:${relay.server.address().port}`;
  const publish=(path,m,key)=>fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(m)});
  const esp=m=>publish('/api/publish',m,token),pi=m=>publish('/api/publish/pi',m,piToken);
  const health=async()=>(await fetch(base+'/health')).json();
  const watch=async (source,until='status')=>{
    const ws=new WebSocket(base.replace('http:','ws:')+'/watch'+(source?`?source=${source}`:'')),messages=[];
    const first=new Promise(resolve=>ws.on('message',x=>{const message=JSON.parse(x);messages.push(message);if(message.type===until)resolve();}));
    await first;return {ws,messages};
  };
  const a=await watch(),b=await watch('pi');
  assert.equal(b.messages[0].source,'pi');assert.equal(b.messages[0].connected,false);assert.equal(b.messages[0].configured,true);
  assert.equal((await publish('/api/publish/pi',manifest,token)).status,401);
  assert.equal((await publish('/api/publish',manifest,piToken)).status,401);
  assert.equal((await publish('/api/publish/unknown',manifest,token)).status,404);
  const pm={...manifest,track:{...manifest.track,name:'Pi circuit'}};
  // Deliberately identical session/race IDs and simultaneous publishes.
  assert.equal((await esp(manifest)).status,200);assert.equal((await pi(pm)).status,200);
  const pf=frame();pf.cars[0][1]=999;
  now+=100;
  assert.equal((await esp(frame())).status,200);assert.equal((await pi(pf)).status,200);
  const ac=await watch(undefined,'frame'),bc=await watch('pi','frame');
  assert.equal(ac.messages.find(m=>m.type==='manifest').track.name,'Test circuit');
  assert.equal(bc.messages.find(m=>m.type==='manifest').track.name,'Pi circuit');
  assert.equal(ac.messages.find(m=>m.type==='frame').cars[0][1],10);
  assert.equal(bc.messages.find(m=>m.type==='frame').cars[0][1],999);
  assert.ok(a.messages.filter(m=>m.type==='frame').every(m=>m.cars[0][1]===10));
  assert.ok(b.messages.filter(m=>m.type==='frame').every(m=>m.cars[0][1]===999));
  now+=100;assert.equal((await pi(pf)).status,409);assert.equal((await esp(frame(2))).status,200);
  now+=4000;assert.equal((await pi({...pf,seq:2})).status,200);
  let h=await health();assert.equal(h.deviceOnline,false);assert.equal(h.sources.pi.connected,true);assert.equal(h.sources.esp32.connected,false);
  now+=100;assert.equal((await esp({...manifest,race:2})).status,200);
  h=await health();assert.equal(h.sources.pi.connected,true);assert.equal(h.sources.pi.viewers,2);
  const late=await watch('esp32');await fetch(base+'/health');assert.equal(late.messages.some(m=>m.type==='frame'),false);
  const bad=new WebSocket(base.replace('http:','ws:')+'/watch?source=unknown');
  await new Promise(resolve=>bad.on('unexpected-response',(_req,res)=>{assert.equal(res.statusCode,404);res.resume();resolve();}));
  bad.terminate();bad.on('error',()=>{});
});

test('Pi is optional and cannot publish until independently configured',{timeout:5000},async t=>{
  assert.throws(()=>createRelay({token,piToken:'short'}));
  assert.throws(()=>createRelay({token,piToken:token}));
  const relay=createRelay({token});relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');t.after(()=>relay.close());
  const url=`http://127.0.0.1:${relay.server.address().port}/api/publish/pi`;
  const health=await (await fetch(`http://127.0.0.1:${relay.server.address().port}/health`)).json();
  assert.equal(health.sources.pi.configured,false);
  assert.equal(health.sources.esp32.configured,true);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(manifest)})).status,503);
});

test('a closed feed cannot send late callbacks into the newly selected tab',t=>{
  const savedLocation=globalThis.location,savedSocket=globalThis.WebSocket;
  const sockets=[];
  globalThis.location={protocol:'https:'};
  globalThis.WebSocket=class{constructor(url){this.url=url;sockets.push(this);}close(){}};
  t.after(()=>{if(savedLocation===undefined)delete globalThis.location;else globalThis.location=savedLocation;globalThis.WebSocket=savedSocket;});
  const old=[],current=[];
  const a=new LiveFeed('https://race.ayxie.com',{status:s=>old.push(s),message:m=>old.push(m)});
  a.close();
  const b=new LiveFeed('https://race.ayxie.com',{status:s=>current.push(s),message:m=>current.push(m)},'pi');
  sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify(frame())});sockets[0].onclose();
  assert.deepEqual(old,['connecting']);
  sockets[1].onopen();sockets[1].onmessage({data:JSON.stringify(frame())});
  const before=current.length;sockets[1].onmessage({data:JSON.stringify({type:'status',connected:true})});
  assert.equal(current.length,before,'healthy heartbeat must not replace live with waiting');
  assert.equal(sockets[1].url,'wss://race.ayxie.com/watch?source=pi');b.close();
});

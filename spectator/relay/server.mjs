import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { validMessage, frameMatchesManifest } from '../shared/protocol.mjs';
import { SOURCES, isSource } from '../shared/sources.mjs';

export function createRelay({token,piToken='',staticDir=resolve(fileURLToPath(new URL('../dist',import.meta.url))),maxViewers=200,clock=Date.now}={}) {
  if(typeof token!=='string'||token.length<32)throw new Error('Set RACE_PUBLISH_TOKEN to a random secret of at least 32 characters.');
  if(typeof piToken!=='string'||(piToken&&piToken.length<32))throw new Error('RACE_PI_PUBLISH_TOKEN must be empty or at least 32 characters.');
  if(piToken===token)throw new Error('Use a different publishing key for each source.');
  let closed=false;
  const feeds=Object.fromEntries(Object.keys(SOURCES).map(source=>[source,{manifest:null,frame:null,lastFrameAt:0,lastRequest:-Infinity,expected:(source==='esp32'?token:piToken)?Buffer.from(`Bearer ${source==='esp32'?token:piToken}`):null}]));
  const wss=new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false});
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const status=source=>({type:'status',source,configured:!!feeds[source].expected,connected:!!feeds[source].frame&&clock()-feeds[source].lastFrameAt<3000});
  const send=(ws,data)=>{if(ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>512*1024){ws.close(1013,'Viewer too slow');return;}ws.send(data);};
  const broadcast=(source,m)=>{const data=JSON.stringify(m);for(const ws of wss.clients)if(ws.source===source)send(ws,data);};
  const server=createServer(async(req,res)=>{
    let path;try{path=new URL(req.url,'http://relay').pathname;}catch{return json(res,400,{error:'Invalid URL'});}
    if(path==='/health')return json(res,200,{ok:true,deviceOnline:status('esp32').connected,viewers:wss.clients.size,sources:Object.fromEntries(Object.keys(SOURCES).map(source=>[source,{configured:status(source).configured,connected:status(source).connected,viewers:[...wss.clients].filter(ws=>ws.source===source).length}]))});
    if(path==='/api/publish'||path.startsWith('/api/publish/')){
      const source=Object.keys(SOURCES).find(key=>SOURCES[key].publishPath===path);
      if(!source)return json(res,404,{error:'Unknown race source'});
      const state=feeds[source],{expected}=state;
      if(req.method!=='POST')return json(res,405,{error:'POST required'});
      if(!expected)return json(res,503,{error:'Publishing for this source is not configured'});
      const provided=Buffer.from(req.headers.authorization||'');if(provided.length!==expected.length||!timingSafeEqual(provided,expected))return json(res,401,{error:'Unauthorized'});
      const now=clock();if(now-state.lastRequest<35)return json(res,429,{error:'Publish rate exceeded'});state.lastRequest=now;
      let size=0,chunks=[];try{for await(const chunk of req){size+=chunk.length;if(size>350000){json(res,413,{error:'Message too large'});req.destroy();return;}chunks.push(chunk);}}catch{return;}
      let message;try{message=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'Invalid JSON'});}
      if(!validMessage(message))return json(res,400,{error:'Invalid protocol message'});
      if(message.type==='manifest'){
        const same=state.manifest&&message.session===state.manifest.session&&message.race===state.manifest.race;
        if(!same){state.frame=null;state.lastFrameAt=0;}state.manifest=message;broadcast(source,message);
      }else{
        if(!state.manifest||!frameMatchesManifest(message,state.manifest))return json(res,409,{error:'Publish the matching manifest first'});
        if(state.frame&&(message.seq<=state.frame.seq||message.t<state.frame.t))return json(res,409,{error:'Out-of-order frame'});
        state.frame=message;state.lastFrameAt=now;broadcast(source,message);
      }
      return json(res,200,{ok:true});
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Read only'});
    let filename;try{filename=resolve(staticDir,`.${decodeURIComponent(path==='/'?'/index.html':path)}`);}catch{return json(res,400,{error:'Invalid path'});}
    if(!filename.startsWith(resolve(staticDir)+sep))return json(res,403,{error:'Forbidden'});
    try{const contents=await readFile(filename);const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};res.writeHead(200,{'Content-Type':types[extname(filename)]||'application/octet-stream','Cache-Control':path.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:contents);}catch{json(res,404,{error:'Not found'});}
  });
  server.headersTimeout=10000;server.requestTimeout=15000;
  server.on('upgrade',(req,socket,head)=>{
    let url;try{url=new URL(req.url,'http://relay');}catch{socket.destroy();return;}
    const source=url.searchParams.get('source')??'esp32';
    if(url.pathname!=='/watch'||!isSource(source)){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
    if(wss.clients.size>=maxViewers){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>{ws.source=source;wss.emit('connection',ws,req);});
  });
  wss.on('connection',ws=>{const {source}=ws,{manifest,frame}=feeds[source];ws.alive=true;ws.on('pong',()=>{ws.alive=true;});ws.on('error',()=>{});ws.on('message',()=>ws.close(1008,'Read-only spectator connection'));send(ws,JSON.stringify(status(source)));if(manifest)send(ws,JSON.stringify(manifest));if(frame&&status(source).connected)send(ws,JSON.stringify(frame));});
  const timer=setInterval(()=>{for(const source of Object.keys(SOURCES))broadcast(source,status(source));for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},10000);timer.unref();
  return {server,wss,close:async()=>{if(closed)return;closed=true;clearInterval(timer);for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>{server.close(r);server.closeAllConnections();});}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const relay=createRelay({token:process.env.RACE_PUBLISH_TOKEN,piToken:process.env.RACE_PI_PUBLISH_TOKEN});const port=Number(process.env.PORT||8787);relay.server.listen(port,'0.0.0.0',()=>console.log(`Race relay listening on port ${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>relay.close().then(()=>process.exit(0)));
}

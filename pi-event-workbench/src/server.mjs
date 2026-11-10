import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Store,Workbench,BUILTINS,assert,validPreset,validTrigger,normalizeGitHub } from './core.mjs';
import { MockRunner,PiRunner } from './pi.mjs';
const dir=dirname(fileURLToPath(import.meta.url));
const cwd=process.cwd();

function scanSkills(root) {
  const dirs=[join(process.env.HOME||'', '.pi/agent/skills'),join(root,'.pi/skills'),join(root,'.agents/skills')];
  const items=[];
  for(const base of dirs){
    if(!existsSync(base))continue;
    for(const entry of readdirSync(base,{withFileTypes:true})){
      if(!entry.isDirectory())continue;
      const path=join(base,entry.name,'SKILL.md');
      if(existsSync(path))items.push({name:entry.name,source:base,path});
    }
  }
  return items;
}
function send(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
function readBody(req,limit=2_000_000){return new Promise((resolve,reject)=>{let size=0;const chunks=[];req.on('data',c=>{size+=c.length;if(size>limit){reject(Object.assign(new Error('Body too large'),{status:413}));req.destroy();}else chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});}
function safeJson(buf){try{return JSON.parse(buf.toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}}
function signed(body,signature,secret){if(!secret||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;const expected='sha256='+createHmac('sha256',secret).update(body).digest('hex');return timingSafeEqual(Buffer.from(signature),Buffer.from(expected));}

export async function createApp(options={}){
  const dataDir=resolve(options.dataDir||process.env.PIWB_DATA_DIR||join(cwd,'data'));
  const store=new Store(join(dataDir,'workbench.db'));
  const runner=options.runner||(options.mock?new MockRunner():new PiRunner(dataDir));
  let piReady=options.mock===true;
  let piError=null;
  if(!options.mock && runner instanceof PiRunner){ try {await runner.init();piReady=true;}catch(e){piError=e.message;} }
  const bus=new Workbench(store,runner);
  const clients=new Set();
  function stream(kind,data){const packet=`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;for(const r of clients){try{r.write(packet);}catch{clients.delete(r);}}}
  for(const kind of ['event','delta','tool','session','notice'])bus.on(kind,data=>stream(kind,data));
  await bus.start();
  const token=options.token??process.env.PIWB_TOKEN??'';
  const githubSecret=options.githubSecret??process.env.PIWB_GITHUB_SECRET??'';
  const host=options.host||'127.0.0.1';
  assert(host==='127.0.0.1'||host==='localhost'||Boolean(token),'Non-local binding requires PIWB_TOKEN');
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      const path=url.pathname;
      // No CORS. Protect state-changing requests from cross-site form/JS requests.
      const origin=req.headers.origin;
      if(origin){const h=new URL(origin).hostname;if(!['localhost','127.0.0.1',host].includes(h))throw Object.assign(new Error('Cross-origin request rejected'),{status:403});}
      const routeIsWebhook=path==='/api/github/webhook';
      const bearer=req.headers.authorization?.replace(/^Bearer\s+/i,'')||'';
      if(token&&!routeIsWebhook&&bearer!==token&&url.searchParams.get('token')!==token)throw Object.assign(new Error('Unauthorized'),{status:401});
      if(req.method==='GET' && (path==='/'||path==='/index.html'||path==='/app.js'||path==='/style.css')){
        const name=path==='/'?'index.html':path.slice(1);
        const bytes=readFileSync(join(dir,'public',name));
        res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(bytes);return;
      }
      if(req.method==='GET'&&path==='/api/stream'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(': connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
      }
      if(req.method==='GET'&&path==='/api/health')return send(res,200,{ok:true,piReady,piError,mock:runner instanceof MockRunner});
      if(req.method==='GET'&&path==='/api/presets')return send(res,200,store.presets());
      if(req.method==='GET'&&path==='/api/sessions')return send(res,200,store.sessions());
      if(req.method==='GET'&&path==='/api/events')return send(res,200,store.events(Math.max(0,Number(url.searchParams.get('after'))||0)));
      if(req.method==='GET'&&path==='/api/resources'){
        const root=resolve(url.searchParams.get('cwd')||cwd);
        const skills=scanSkills(root);
        let models=[];try{models=await runner.models?.()||[];}catch{}
        return send(res,200,{tools:BUILTINS.map(name=>({name,source:'PI Builtin'})),skills,models});
      }
      if(req.method==='POST'&&path==='/api/presets'){
        const input=safeJson(await readBody(req));const p=validPreset(input);
        assert(!store.presets().some(x=>x.name===p.name),'Duplicate preset name',409);
        store.savePreset(p);stream('presets',store.presets());return send(res,201,p);
      }
      const presetPath=path.match(/^\/api\/presets\/([a-zA-Z0-9-]+)$/);
      if(presetPath&&(req.method==='PUT'||req.method==='DELETE')){
        const prev=store.presets().find(p=>p.id===presetPath[1]);assert(prev,'Preset not found',404);
        if(req.method==='DELETE'){store.deletePreset(prev.id);stream('presets',store.presets());return send(res,200,{ok:true});}
        const input=safeJson(await readBody(req));const p=validPreset({...prev,...input,id:prev.id});
        assert(!store.presets().some(x=>x.name===p.name&&x.id!==p.id),'Duplicate preset name',409);
        store.savePreset(p);stream('presets',store.presets());return send(res,200,p);
      }
      if(req.method==='POST'&&path==='/api/trigger/test'){
        const {matches}=await import('./core.mjs');const input=safeJson(await readBody(req));validTrigger(input.rule);
        return send(res,200,{matched:matches(input.event,input.preset,input.rule)});
      }
      if(req.method==='POST'&&path==='/api/messages'){
        const input=safeJson(await readBody(req));return send(res,201,bus.userMessage(input.content,input.replySessionId||null));
      }
      const abortMatch=path.match(/^\/api\/sessions\/([a-f0-9-]+)\/abort$/);
      if(req.method==='POST'&&abortMatch){await bus.abort(abortMatch[1]);return send(res,200,{ok:true});}
      if(req.method==='POST'&&path==='/api/events'){
        const input=safeJson(await readBody(req));assert(typeof input.eventType==='string'&&input.eventType.length<100,'Invalid eventType');
        assert(typeof input.content==='string','Missing content');
        const e=bus.publish({source:{type:'api',id:'external'},eventType:input.eventType,content:input.content,payload:input.payload||{},dedupeKey:input.dedupeKey});return send(res,201,e);
      }
      if(req.method==='POST'&&routeIsWebhook){
        const raw=await readBody(req);
        assert(signed(raw,req.headers['x-hub-signature-256'],githubSecret),'Invalid webhook signature',403);
        const payload=safeJson(raw);
        if(req.headers['x-github-event']==='ping')return send(res,200,{ok:true,ping:true});
        const e=bus.publish(normalizeGitHub(req.headers,payload));return send(res,202,e);
      }
      send(res,404,{error:'Not found'});
    }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.message});}
  });
  const tick=setInterval(()=>{for(const r of clients)try{r.write(': ping\n\n');}catch{clients.delete(r);}},15000);tick.unref();
  return {server,bus,store,runner,close:()=>new Promise(r=>{clearInterval(tick);for(const c of clients)c.end();server.close(()=>{store.close();r();});})};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const get=(flag,defaultValue)=>{const ix=process.argv.indexOf(flag);return ix>=0?process.argv[ix+1]:defaultValue;};
  const host=get('--host',process.env.PIWB_HOST||'127.0.0.1');
  const port=Number(get('--port',process.env.PIWB_PORT||'3098'));
  const mock=process.argv.includes('--mock');
  createApp({host,mock}).then(app=>app.server.listen(port,host,()=>console.log(`PI Event Workbench: http://${host}:${port} (${mock?'mock':'PI SDK'})`))).catch(e=>{console.error(e);process.exitCode=1;});
}
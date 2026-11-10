import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store,Workbench,validPreset,matches,parseMentions,normalizeGitHub } from '../src/core.mjs';
import { MockRunner } from '../src/pi.mjs';
import { createApp } from '../src/server.mjs';

const inTemp=(fn)=>{const dir=mkdtempSync(join(tmpdir(),'pi-wb-'));return Promise.resolve().then(()=>fn(dir)).finally(()=>rmSync(dir,{recursive:true,force:true}));};
const preset=(name,triggers)=>validPreset({name,triggers});
const mention={source:'user',eventType:'chat.message',field:'mentions',operator:'contains',value:'$self',enabled:true};
const github={source:'github',eventType:'github.pr.opened',field:'payload.repository',operator:'equals',value:'org/repo',enabled:true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(predicate){for(let i=0;i<80;i++){if(predicate())return;await sleep(20)}throw new Error('Condition timed out');}

test('mentions use exact preset names, ignore quoted/fenced blocks and do not match prefix',()=>{
 const p=preset('开发',[mention]);const q=preset('开发助手',[mention]);
 assert.deepEqual(parseMentions('@开发 修复登录',[p,q]),[p.id]);
 assert.deepEqual(parseMentions('@开发助手 完成',[p,q]),[q.id]);
 assert.deepEqual(parseMentions('> @开发\n```\n@开发\n```',[p,q]),[]);
 assert.deepEqual(parseMentions('reviewer@开发',[p,q]),[]);
});
test('field and regex rules; rejects malformed rules',()=>{
 const p=preset('review',[github]);
 const e={source:{type:'github'},eventType:'github.pr.opened',payload:{repository:'org/repo'},content:'PR opened'};
 assert.equal(matches(e,p,github),true);
 assert.equal(matches({...e,source:{type:'user'}},p,github),false);
 assert.equal(matches(e,p,{...github,field:'content',operator:'regex',value:'PR\\s+opened'}),true);
 assert.throws(()=>validPreset({name:'bad',triggers:[{...github,operator:'regex',value:'('}]}),/Invalid regex/);
});
test('SQLite persistence and dedupe survive restart',()=>inTemp(dir=>{
 const f=join(dir,'db');const store=new Store(f);const p=preset('开发',[mention]);store.savePreset(p);
 const e={id:'e1',dedupeKey:'github:123',eventType:'chat.message',content:'Hello'};
 assert.ok(store.event(e));assert.equal(store.event({...e,id:'e2'}),null);store.close();
 const db=new Store(f);assert.equal(db.presets()[0].name,'开发');assert.equal(db.events().length,1);db.close();
}));
test('message bus creates fresh session per mention, supports continuation, avoids agent loops',()=>inTemp(async dir=>{
 const store=new Store(join(dir,'db'));const runner=new MockRunner();const bus=new Workbench(store,runner);
 const p=preset('开发',[mention,{source:'agent',eventType:'agent.completed',field:'content',operator:'exists',enabled:true}]);store.savePreset(p);
 bus.userMessage('@开发 first');bus.userMessage('@开发 second');
 await waitFor(()=>store.events().filter(e=>e.eventType==='agent.completed').length===2);
 const sessions=store.sessions();assert.equal(sessions.length,2);
 assert.notEqual(sessions[0].id,sessions[1].id);
 assert.equal(store.events().filter(e=>e.eventType==='agent.completed').length,2);
 bus.userMessage('continue',sessions[0].id);
 await waitFor(()=>store.events().filter(e=>e.eventType==='agent.completed').length===3);
 assert.equal(store.sessions().length,2);store.close();
}));
test('agent completion can trigger a different preset, chain cannot loop',()=>inTemp(async dir=>{
 const store=new Store(join(dir,'db'));const bus=new Workbench(store,new MockRunner());
 const a=preset('A',[mention]);const b=preset('B',[{source:'agent',eventType:'agent.completed',field:'payload.preset',operator:'equals',value:'A'}]);
 store.savePreset(a);store.savePreset(b);bus.userMessage('@A test');
 await waitFor(()=>store.events().filter(e=>e.eventType==='agent.completed').length===2);
 assert.equal(store.sessions().length,2);store.close();
}));
test('GitHub payload maps to typed event with dedupe key',()=>{
 const e=normalizeGitHub({'x-github-event':'pull_request','x-github-delivery':'d123'}, {action:'opened',repository:{full_name:'org/repo'},pull_request:{number:3,title:'Fix',html_url:'https://github.com/org/repo/pull/3'}});
 assert.equal(e.eventType,'github.pr.opened');assert.equal(e.payload.repository,'org/repo');assert.equal(e.dedupeKey,'github:d123');
});
test('HTTP API, SSE endpoint and webhook signature enforcement',()=>inTemp(async dir=>{
 const app=await createApp({dataDir:dir,mock:true,githubSecret:'secret'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const port=app.server.address().port, root=`http://127.0.0.1:${port}`;
 async function req(path,method='GET',body,headers={}){return fetch(root+path,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});}
 try{
  assert.equal((await (await req('/api/health')).json()).mock,true);
  const p=await (await req('/api/presets','POST',{name:'dev'})).json();assert.equal(p.name,'dev');
  const msg=await (await req('/api/messages','POST',{content:'@dev hi'})).json();assert.equal(msg.eventType,'chat.message');
  await waitFor(()=>app.store.events().some(e=>e.eventType==='agent.completed'));
  assert.equal(app.store.sessions().length,1);
  assert.equal((await req('/api/github/webhook','POST',{action:'opened'})).status,403);
  assert.equal((await req('/api/events','POST',{eventType:'alert',content:'oops'})).status,201);
  const eventList=await (await req('/api/events')).json();assert.ok(eventList.length>=4);
 }finally{await app.close();}
}));
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const BUILTINS = ['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls'];
const value = v => JSON.stringify(v);
const parse = v => JSON.parse(v);
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export function assert(ok, message, code = 400) { if (!ok) { const e = new Error(message); e.status = code; throw e; } }
export function validPreset(input) {
  assert(input && typeof input === 'object', 'Preset must be an object');
  const name = String(input.name || '').trim();
  assert(name.length > 0 && name.length <= 32 && !/[\s@]/u.test(name), 'Preset name must be 1–32 characters without spaces or @');
  const cwd = resolve(String(input.cwd || process.cwd()));
  const tools = input.tools ?? ['read', 'grep', 'find', 'ls'];
  const skills = input.skills ?? [];
  assert(Array.isArray(tools) && tools.every(x => typeof x === 'string' && x.length < 128), 'Invalid tools');
  assert(Array.isArray(skills) && skills.every(x => typeof x === 'string' && x.length < 128), 'Invalid skills');
  const triggers = input.triggers ?? [{ source: 'user', eventType: 'chat.message', field: 'mentions', operator: 'contains', value: '$self', enabled: true }];
  assert(Array.isArray(triggers) && triggers.length <= 30, 'Too many triggers');
  triggers.forEach(validTrigger);
  return {
    id: input.id || id(), name, avatar: String(input.avatar || '◆').slice(0, 4),
    provider: String(input.provider || ''), model: String(input.model || ''),
    thinkingLevel: String(input.thinkingLevel || 'off'), cwd,
    tools: [...new Set(tools)], skills: [...new Set(skills)],
    instructions: String(input.instructions || '').slice(0, 100000),
    triggers, enabled: input.enabled !== false,
    maxConcurrency: Math.max(1, Math.min(4, Number(input.maxConcurrency) || 1))
  };
}
export function validTrigger(rule) {
  assert(rule && typeof rule === 'object', 'Invalid trigger');
  assert(['user', 'github', 'agent', 'api', 'system', '*'].includes(rule.source), 'Invalid source');
  assert(typeof rule.eventType === 'string' && rule.eventType.length < 120, 'Invalid eventType');
  assert(['contains', 'equals', 'regex', 'exists'].includes(rule.operator), 'Invalid operator');
  assert(typeof rule.field === 'string' && /^(content|mentions|payload(?:\.[a-zA-Z0-9_]{1,64}){1,3})$/.test(rule.field), 'Invalid field');
  if (rule.operator === 'regex') {
    assert(typeof rule.value === 'string' && rule.value.length <= 256, 'Regex must be <= 256 characters');
    try { new RegExp(rule.value, 'u'); } catch { assert(false, 'Invalid regex'); }
  }
}
export function atPath(object, path) { return path.split('.').reduce((x, part) => x?.[part], object); }
export function parseMentions(content, presets) {
  // Ignore fenced code and quoted Markdown lines; longest names first, exact boundary.
  const plain = String(content).replace(/```[\s\S]*?```/g, '').split('\n').filter(x => !/^\s*>/.test(x)).join('\n');
  const mentions = [];
  for (const p of [...presets].sort((a, b) => b.name.length - a.name.length)) {
    const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[\\s（(，,])@${escaped}(?=$|[\\s，,。！!？?）)])`, 'u').test(plain)) mentions.push(p.id);
  }
  return mentions;
}
export function matches(event, preset, rule) {
  if (rule.enabled === false || (rule.source !== '*' && rule.source !== event.source.type)) return false;
  if (rule.eventType !== '*' && rule.eventType !== event.eventType) return false;
  const target = atPath(event, rule.field);
  const expected = rule.value === '$self' ? preset.id : rule.value;
  if (rule.operator === 'exists') return target !== undefined && target !== null;
  if (rule.operator === 'contains') return Array.isArray(target) ? target.includes(expected) : String(target ?? '').includes(String(expected));
  if (rule.operator === 'equals') return target === expected;
  if (rule.operator === 'regex') {
    // Reject long targets and common backtracking constructs; this is not a full ReDoS proof.
    const text = String(target ?? '').slice(0, 2048);
    if (/(\([^)]*[+*][^)]*\))[+*{]/u.test(rule.value)) return false;
    return new RegExp(rule.value, 'u').test(text);
  }
  return false;
}

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS presets(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, dedupe_key TEXT UNIQUE, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, event_id TEXT NOT NULL, preset_id TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER DEFAULT 0, UNIQUE(event_id,preset_id));
      CREATE INDEX IF NOT EXISTS events_by_seq ON events(seq);
      CREATE INDEX IF NOT EXISTS deliveries_by_status ON deliveries(status);`);
  }
  close() { this.db.close(); }
  presets() { return this.db.prepare('SELECT json FROM presets ORDER BY name').all().map(x => parse(x.json)); }
  savePreset(p) {
    this.db.prepare(`INSERT INTO presets(id,name,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,json=excluded.json`).run(p.id,p.name,value(p));
    return p;
  }
  deletePreset(id) { return this.db.prepare('DELETE FROM presets WHERE id=?').run(id).changes; }
  events(after = 0, limit = 500) { return this.db.prepare('SELECT seq,json FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after,Math.min(1000,limit)).map(x=>({...parse(x.json),seq:x.seq})); }
  event(event) {
    const result = this.db.prepare('INSERT OR IGNORE INTO events(id,dedupe_key,json) VALUES(?,?,?)').run(event.id,event.dedupeKey||null,value(event));
    if (!result.changes) return null;
    return {...event, seq:Number(result.lastInsertRowid)};
  }
  session(s) { this.db.prepare(`INSERT INTO sessions(id,preset_id,status,json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,json=excluded.json`).run(s.id,s.presetId,s.status,value(s));return s; }
  getSession(id) { const s=this.db.prepare('SELECT json FROM sessions WHERE id=?').get(id); return s?parse(s.json):null; }
  sessions() { return this.db.prepare('SELECT json FROM sessions ORDER BY rowid DESC').all().map(x=>parse(x.json)); }
  delivery(eventId,presetId) { return this.db.prepare(`INSERT OR IGNORE INTO deliveries(id,event_id,preset_id,status) VALUES(?,?,?,'pending')`).run(id(),eventId,presetId).changes > 0; }
  take(presetId) { const row=this.db.prepare(`SELECT * FROM deliveries WHERE preset_id=? AND status='pending' ORDER BY rowid LIMIT 1`).get(presetId); if(!row)return null; this.db.prepare(`UPDATE deliveries SET status='running',attempts=attempts+1 WHERE id=?`).run(row.id);return row; }
  deliveryDone(id, status) { this.db.prepare('UPDATE deliveries SET status=? WHERE id=?').run(status,id); }
  unprocessed() { return this.db.prepare(`SELECT DISTINCT preset_id FROM deliveries WHERE status='pending'`).all().map(x=>x.preset_id); }
  resetRunning() { this.db.exec(`UPDATE deliveries SET status='pending' WHERE status='running'`);const stuck=this.db.prepare("SELECT json FROM sessions WHERE status='running'").all();for(const row of stuck){const item=parse(row.json);item.status='interrupted';this.session(item);} }
  findEvent(id) { const row=this.db.prepare('SELECT json FROM events WHERE id=?').get(id);return row?parse(row.json):null; }
}

export function normalizeGitHub(headers, payload) {
  const kind = String(headers['x-github-event'] || '').toLowerCase();
  const action = String(payload.action || 'unknown');
  const mapping = { pull_request:'pr', issues:'issue' };
  assert(mapping[kind], 'Unsupported GitHub event', 422);
  const item = payload.pull_request || payload.issue;
  assert(item && payload.repository?.full_name, 'Invalid GitHub payload');
  return {
    source: {type:'github',id:String(payload.sender?.login||'github')},
    eventType:`github.${mapping[kind]}.${action}`,
    content:`${payload.repository.full_name} #${item.number}: ${item.title || ''}\n${item.html_url || ''}`,
    payload:{repository:payload.repository.full_name, number:item.number, title:item.title || '', url:item.html_url || '', action, body:String(item.body||'').slice(0,4000)},
    dedupeKey:`github:${headers['x-github-delivery']||id()}`
  };
}

export class Workbench extends EventEmitter {
  constructor(store, runner, options={}) {
    super();this.store=store;this.runner=runner;this.depthLimit=options.depthLimit??3;
    this.running=new Map();this.active=new Map();this.pumping=new Set();
    this.store.resetRunning();
  }
  async start() { for (const id of this.store.unprocessed()) this.pump(id); }
  publish(input, route=true) {
    const event = {
      id:id(), groupId:'main', timestamp:now(), source:input.source,
      eventType:input.eventType,content:String(input.content||'').slice(0,50000),
      payload:input.payload||{},mentions:input.mentions||[],
      sessionId:input.sessionId||null, parentEventId:input.parentEventId||null,
      correlationId:input.correlationId||id(),depth:input.depth||0,
      lineage:input.lineage||[],dedupeKey:input.dedupeKey||null
    };
    const saved=this.store.event(event);
    if (!saved)return {duplicate:true};
    this.emit('event',saved);
    if (route && event.depth<this.depthLimit) {
      for (const p of this.store.presets().filter(p=>p.enabled)) {
        if (event.source.type==='agent' && (p.id===event.source.id || event.lineage.includes(p.id))) continue;
        if (p.triggers.some(t=>matches(event,p,t))) {
          if(this.store.delivery(event.id,p.id))this.pump(p.id);
        }
      }
    }
    return saved;
  }
  userMessage(content, replySessionId=null) {
    assert(typeof content==='string' && content.trim(), 'Message cannot be empty');
    const sessions=replySessionId?this.store.getSession(replySessionId):null;
    if(replySessionId)assert(sessions,'Session not found',404);
    const e=this.publish({source:{type:'user',id:'local'},eventType:'chat.message',content,mentions:replySessionId?[]:parseMentions(content,this.store.presets()),sessionId:replySessionId},!replySessionId);
    if(replySessionId)this.continueSession(replySessionId,content,e).catch(err=>this.emit('notice',{sessionId:replySessionId,text:err.message}));
    return e;
  }
  async continueSession(sessionId,content,event) {
    const s=this.store.getSession(sessionId);assert(s,'Session not found',404);
    if(this.active.has(sessionId)) { this.emit('notice',{sessionId,text:'Session is busy; reply rejected'});return; }
    const p=this.store.presets().find(p=>p.id===s.presetId);
    if(!p){this.emit('notice',{sessionId,text:'Preset was deleted'});return;}
    await this.runSession(p,event,s);
  }
  async pump(presetId) {
    if(this.pumping.has(presetId))return;
    this.pumping.add(presetId);
    try {
      while(true) {
        const p=this.store.presets().find(x=>x.id===presetId);
        if(!p||!p.enabled) break;
        const active=[...this.active.values()].filter(x=>x.presetId===presetId).length;
        if(active>=p.maxConcurrency)break;
        const item=this.store.take(presetId);
        if(!item)break;
        const event=this.store.findEvent(item.event_id);
        if(!event){this.store.deliveryDone(item.id,'failed');continue;}
        const task=this.runSession(p,event).then(()=>this.store.deliveryDone(item.id,'done')).catch(e=>{this.store.deliveryDone(item.id,'failed');this.emit('notice',{text:e.message});}).finally(()=>{this.running.delete(item.id);this.pump(presetId);});
        this.running.set(item.id,task);
      }
    } finally { this.pumping.delete(presetId); }
  }
  async runSession(p,event,existing=null) {
    const sid=existing?.id||id();
    const info=existing||{id:sid,presetId:p.id,createdAt:now(),file:null};
    info.status='running';this.store.session(info);
    this.emit('session',info);
    this.active.set(sid,{presetId:p.id,abort:null});
    this.publish({source:{type:'system',id:'runtime'},eventType:'agent.started',content:`${p.name} 开始执行`,sessionId:sid,payload:{preset:p.name},parentEventId:event.id,correlationId:event.correlationId,depth:event.depth+1},false);
    let response='';
    try {
      response=await this.runner.run({preset:p,event,session:info,onFile:file=>{info.file=file;this.store.session(info);},onDelta:delta=>this.emit('delta',{sessionId:sid,presetId:p.id,delta}),onTool:tool=>this.emit('tool',{sessionId:sid,presetId:p.id,...tool}),onAbort:fn=>{this.active.get(sid).abort=fn;}});
      info.status='idle';this.store.session(info);this.emit('session',info);
      this.publish({source:{type:'agent',id:p.id},eventType:'agent.completed',content:response,sessionId:sid,payload:{preset:p.name},parentEventId:event.id,correlationId:event.correlationId,depth:event.depth+1,lineage:[...event.lineage,p.id]});
    }catch(e){
      info.status='failed';this.store.session(info);this.emit('session',info);
      this.publish({source:{type:'agent',id:p.id},eventType:'agent.failed',content:String(e.message),sessionId:sid,payload:{preset:p.name},parentEventId:event.id,correlationId:event.correlationId,depth:event.depth+1,lineage:[...event.lineage,p.id]});
      throw e;
    }finally{this.active.delete(sid);}
  }
  abort(sessionId){const item=this.active.get(sessionId);assert(item,'Session not running',404);assert(item.abort,'Session not ready to stop',409);return item.abort();}
}
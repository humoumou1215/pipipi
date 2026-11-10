import { join } from 'node:path';

// Explicit mock for deterministic integration tests; NEVER silently fall back in production.
export class MockRunner {
  async run({preset,event,session,onFile,onDelta,onAbort}) {
    onFile(`mock:${session.id}`);
    let cancelled=false;onAbort(()=>{cancelled=true;});
    await new Promise(resolve=>setTimeout(resolve,15));
    if(cancelled)throw new Error('Aborted');
    const answer=`[Mock · ${preset.name}] ${event.content}`;
    onDelta(answer);
    return answer;
  }
}

export class PiRunner {
  constructor(dataDir) { this.dataDir=dataDir; this.sdk=null; this.modelRuntime=null; }
  async init() {
    try { this.sdk=await import('@earendil-works/pi-coding-agent'); }
    catch(e) { throw new Error(`Missing PI SDK. Run: npm install @earendil-works/pi-coding-agent (${e.code||e.message})`); }
    this.modelRuntime=await this.sdk.ModelRuntime.create();
  }
  async models() {
    if(!this.modelRuntime)return [];
    const available=await this.modelRuntime.getAvailable();
    return available.map(m=>({provider:m.provider,model:m.id}));
  }
  async run({preset,event,session:record,onFile,onDelta,onTool,onAbort}) {
    if(!this.sdk)await this.init();
    const {createAgentSession,DefaultResourceLoader,SessionManager}=this.sdk;
    const loader=new DefaultResourceLoader({
      cwd:preset.cwd,
      appendSystemPromptOverride:(base)=>[...base, ...(preset.instructions?[preset.instructions]:[])],
      skillsOverride:current=>({ ...current, skills:current.skills.filter(s=>preset.skills.includes(s.name)) })
    });
    await loader.reload();
    const model=preset.provider&&preset.model?this.modelRuntime.getModel(preset.provider,preset.model):undefined;
    if((preset.provider||preset.model)&&!model)throw new Error(`Model unavailable: ${preset.provider}/${preset.model}`);
    const options={cwd:preset.cwd,resourceLoader:loader,modelRuntime:this.modelRuntime,
      ...(preset.tools.length?{tools:preset.tools}:{noTools:'all'}),
      thinkingLevel:preset.thinkingLevel,
      sessionManager: record.file ? SessionManager.open(record.file) : SessionManager.create(preset.cwd,join(this.dataDir,'pi-sessions'))};
    if(model)options.model=model;
    const {session}=await createAgentSession(options);
    let active=true;
    onFile(session.sessionFile);
    onAbort(()=>session.abort());
    const unsubscribe=session.subscribe(e=>{
      if(e.type==='message_update' && e.assistantMessageEvent?.type==='text_delta')onDelta(e.assistantMessageEvent.delta);
      if(e.type==='tool_execution_start')onTool({phase:'start',name:e.toolName,toolCallId:e.toolCallId,args:e.args});
      if(e.type==='tool_execution_end')onTool({phase:'end',name:e.toolName,toolCallId:e.toolCallId,isError:e.isError});
    });
    try {
      await session.prompt(event.content);
      const text=session.getLastAssistantText();
      return typeof text==='string'?text:'';
    } finally { if(active){active=false;unsubscribe();session.dispose();} }
  }
}
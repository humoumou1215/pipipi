const $=s=>document.querySelector(s);
const state={presets:[],events:[],sessions:[],resources:{tools:[],skills:[],models:[]},selected:null,draft:null,reply:null,streams:{},toolLog:{}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=s=>{const x=$('#toast');x.textContent=s;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),3500);};
async function api(path,method='GET',body){const res=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error||res.statusText);return data;}
const call=async fn=>{try{return await fn();}catch(e){toast(e.message);console.error(e);}};
const unique=a=>[...new Set(a)];
function pick(id){state.selected=id;state.draft=structuredClone(state.presets.find(x=>x.id===id)||null);renderMembers();renderConfig();if(innerWidth<800)document.querySelector('.config').classList.add('open');}
function renderMembers(){const container=$('#members');container.replaceChildren();for(const p of state.presets){const btn=document.createElement('button');btn.className='member'+(p.id===state.selected?' active':'');btn.innerHTML=`<span class="avatar">${esc(p.avatar)}</span><span class="name">${esc(p.name)}</span><span class="secondary">${p.enabled?'●':'○'}</span>`;btn.onclick=()=>pick(p.id);container.append(btn);}}
function optionList(values,selected){return values.map(([label,val])=>`<option value="${esc(val)}" ${val===selected?'selected':''}>${esc(label)}</option>`).join('');}
function renderResources(){const p=state.draft;if(!p)return;
  for(const [kind,container] of [['tools',$('#tools')],['skills',$('#skills')]]){
    const items=kind==='tools'?state.resources.tools:state.resources.skills;
    const groups=Object.groupBy(items,x=>x.source||'Other');container.replaceChildren();
    for(const [source,entries] of Object.entries(groups)){
      const row=document.createElement('div');row.className='res-row';
      const enabled=entries.filter(x=>p[kind].includes(x.name)).length;
      row.innerHTML=`<div class="res-source"><input type="checkbox" ${enabled===entries.length?'checked':''} aria-label="切换 ${esc(source)}"><span>${esc(source.split('/').at(-1))}</span></div><div class="res-items"></div>`;
      const all=row.querySelector('input');all.indeterminate=enabled>0&&enabled<entries.length;
      all.onchange=()=>{p[kind]=unique([...p[kind].filter(n=>!entries.some(x=>x.name===n)),...(all.checked?entries.map(x=>x.name):[])]);renderResources();};
      for(const item of entries){const lab=document.createElement('label');lab.className='tiny-check';const ck=document.createElement('input');ck.type='checkbox';ck.checked=p[kind].includes(item.name);ck.onchange=()=>{p[kind]=ck.checked?unique([...p[kind],item.name]):p[kind].filter(x=>x!==item.name);renderResources();};lab.append(ck,document.createTextNode(item.name));row.querySelector('.res-items').append(lab);}
      container.append(row);
    }
    if(!items.length)container.textContent='暂未发现资源';
    $(kind==='tools'?'#toolCount':'#skillCount').textContent=`${p[kind].length}/${items.length}`;
  }
}
function triggerRow(rule,i){const card=document.createElement('div');card.className='trigger-card';card.innerHTML=`<div class="trigger-head"><span>规则 ${i+1}</span><button type="button" title="删除">×</button></div><div class="trigger-grid"><select data-key="source">${optionList([['用户','user'],['GitHub','github'],['Agent','agent'],['API','api'],['系统','system'],['任意来源','*']],rule.source)}</select><input data-key="eventType" placeholder="chat.message 或 *" value="${esc(rule.eventType)}"><select data-key="field">${optionList([['mentions','mentions'],['消息正文','content'],['payload.repository','payload.repository'],['payload.title','payload.title'],['payload.action','payload.action']],rule.field)}</select><select data-key="operator">${optionList([['包含','contains'],['等于','equals'],['正则','regex'],['存在','exists']],rule.operator)}</select><input data-key="value" placeholder="$self 或正则" value="${esc(rule.value??'')}"><label class="tiny-check"><input data-key="enabled" type="checkbox" ${rule.enabled!==false?'checked':''}>启用</label></div>`;
  card.querySelector('button').onclick=()=>{state.draft.triggers.splice(i,1);renderTriggers();};
  card.querySelectorAll('[data-key]').forEach(el=>el.onchange=()=>{rule[el.dataset.key]=el.type==='checkbox'?el.checked:el.value;});
  return card;
}
function renderTriggers(){const parent=$('#triggers');parent.replaceChildren();state.draft?.triggers.forEach((r,i)=>parent.append(triggerRow(r,i)));}
function renderConfig(){const p=state.draft;$('#presetForm').classList.toggle('hidden',!p);$('#emptyConfig').classList.toggle('hidden',!!p);if(!p)return;
  for(const key of ['name','avatar','provider','model','cwd','instructions'])$('#'+key).value=p[key]||'';
  $('#thinking').value=p.thinkingLevel;$('#concurrency').value=String(p.maxConcurrency||1);$('#enabled').checked=p.enabled;
  renderResources();renderTriggers();$('#saveStatus').textContent='';
}
function renderTimeline(){const box=$('#timeline');const atBottom=box.scrollTop+box.clientHeight>=box.scrollHeight-120;box.replaceChildren();
  $('#count').textContent=`${state.events.length} events`;
  if(!state.events.length){box.innerHTML='<div class="empty">还没有消息。使用 @Preset 发送任务，或者配置触发规则。</div>';return;}
  for(const e of state.events){
    const owner=state.presets.find(p=>p.id===e.source.id);
    const type=e.source.type;const who=type==='user'?'我':type==='agent'?(owner?.name||'Agent'):type==='github'?'GitHub':type==='api'?'API':'System';
    const av=type==='user'?'◉':type==='github'?'⑂':owner?.avatar||'◆';
    const item=document.createElement('article');item.className=`item ${type==='user'?'me':type}`;
    const session=e.sessionId?state.sessions.find(s=>s.id===e.sessionId):null;
    item.innerHTML=`<div class="bubble-avatar">${esc(av)}</div><div class="bubble"><div class="meta"><b>${esc(who)}</b><span class="event-type">${esc(e.eventType)}</span>${session?`<small>${esc(session.id.slice(0,8))} · ${esc(session.status)}</small>`:''}<small>${esc(new Date(e.timestamp).toLocaleTimeString())}</small></div><div class="body">${esc(e.content)}</div><div class="actions"></div></div>`;
    if(e.sessionId){const btn=document.createElement('button');btn.textContent='↳ 继续 Session';btn.onclick=()=>{state.reply=e.sessionId;$('#replyBadge').classList.remove('hidden');$('#replyBadge').innerHTML=`回复 Session ${esc(e.sessionId.slice(0,8))} <button id="cancelReply" type="button">×</button>`;$('#cancelReply').onclick=()=>{state.reply=null;$('#replyBadge').classList.add('hidden');};$('#message').focus();};item.querySelector('.actions').append(btn);}
    if(session?.status==='running'){const btn=document.createElement('button');btn.textContent='停止';btn.onclick=()=>call(()=>api(`/sessions/${session.id}/abort`,'POST'));item.querySelector('.actions').append(btn);}
    if(e.sessionId&&session?.status==='running'&&state.streams[e.sessionId]&&e.eventType==='agent.started'){
      const progress=document.createElement('div');progress.className='body';progress.style.marginTop='8px';progress.textContent=state.streams[e.sessionId];item.querySelector('.bubble').append(progress);
    }
    box.append(item);
  }
  if(atBottom)box.scrollTop=box.scrollHeight;
}
async function refresh(){const [presets,events,sessions,resources,health]=await Promise.all([api('/presets'),api('/events'),api('/sessions'),api('/resources'),api('/health')]);state.presets=presets;state.events=events;state.sessions=sessions;state.resources=resources;$('#status').textContent=health.mock?'Mock 模式':health.piReady?'PI SDK 就绪':`PI SDK 未就绪`;
  if(state.selected&&!presets.some(x=>x.id===state.selected))state.selected=null;
  if(state.selected)state.draft=structuredClone(presets.find(x=>x.id===state.selected));renderMembers();renderConfig();renderTimeline();}
$('#add').onclick=()=>call(async()=>{const p=await api('/presets','POST',{name:`Agent${Math.floor(Math.random()*10000)}`,avatar:'✦',cwd:'',tools:['read','grep','find','ls']});state.presets.push(p);pick(p.id);});
$('#refresh').onclick=()=>call(refresh);
$('#delete').onclick=()=>call(async()=>{if(!state.selected)return;if(!confirm('删除 Preset？历史事件和 Session 仍然保留。'))return;await api('/presets/'+state.selected,'DELETE');state.selected=null;await refresh();});
$('#presetForm').onsubmit=e=>{e.preventDefault();call(async()=>{const p=state.draft;if(!p)return;for(const key of ['name','avatar','provider','model','cwd','instructions'])p[key]=$('#'+key).value;p.thinkingLevel=$('#thinking').value;p.maxConcurrency=Number($('#concurrency').value);p.enabled=$('#enabled').checked;await api('/presets/'+p.id,'PUT',p);$('#saveStatus').textContent='已保存';await refresh();toast('Preset 已保存');});};
$('#addTrigger').onclick=()=>{if(!state.draft)return;state.draft.triggers.push({source:'user',eventType:'chat.message',field:'mentions',operator:'contains',value:'$self',enabled:true});renderTriggers();};
$('#composer').onsubmit=e=>{e.preventDefault();call(async()=>{const input=$('#message');const text=input.value.trim();if(!text)return;await api('/messages','POST',{content:text,replySessionId:state.reply});input.value='';state.reply=null;$('#replyBadge').classList.add('hidden');await refresh();});};
$('#message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#composer').requestSubmit();}};
const stream=new EventSource('/api/stream');
stream.addEventListener('event',e=>{const item=JSON.parse(e.data);if(!state.events.some(x=>x.id===item.id)){state.events.push(item);state.events.sort((a,b)=>a.seq-b.seq);renderTimeline();}});
stream.addEventListener('session',e=>{const x=JSON.parse(e.data);const i=state.sessions.findIndex(s=>s.id===x.id);if(i<0)state.sessions.push(x);else state.sessions[i]=x;renderTimeline();});
stream.addEventListener('delta',e=>{const x=JSON.parse(e.data);state.streams[x.sessionId]=(state.streams[x.sessionId]||'')+x.delta;renderTimeline();});
stream.addEventListener('presets',()=>call(refresh));stream.addEventListener('notice',e=>toast(JSON.parse(e.data).text));
stream.onerror=()=>{$('#status').textContent='连接重试中…';};
call(refresh);
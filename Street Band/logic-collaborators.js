/** File ▸ Share ▸ Collaborators… — list, change role, remove.
 *
 * getProjectShare GET /projects/{id}/share → ProjectShare {visibility, defaultRole,
 * people[], shareUrl, …}: "collaborators with their roles … and the caller's own role"
 * (people rows are open objects). setCollaboratorRole PUT
 * /projects/{id}/collaborators/{user}/role {role: viewer|editor} and removeCollaborator
 * DELETE /projects/{id}/collaborators/{user} (no body; "the DELETE itself is the
 * confirmation", so the UI asks first) both answer the new ProjectShare; owner only.
 * {user} is "a user id or an @username from getProjectShare". Neither is a timeline
 * edit, so neither is a ⌘Z step. Live shape (2026-11-16): {currentUserRole, defaultRole,
 * collaboratorCount, people:[{userId, handle:"@name", displayName, role, origin, isCurrentUser,
 * profileUrl, since}]}: keyed by userId (fallback handle); origin "owner" is the owner row. One retained Idempotency-Key per action; an unknown
 * outcome is asked once more with it, then the list is re-read.
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.trim():'';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const fail=(message,code='collaborators_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
const transient=error=>{const status=Number(error?.status);return error?.dispatched!==false&&(!Number.isInteger(status)||status===0||status===408||status>=500);};
const defaultKey=()=>globalThis.crypto?.randomUUID?.()||`share-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const COLLABORATOR_OPERATIONS=Object.freeze(['getProjectShare','setCollaboratorRole','removeCollaborator']);
export const COLLABORATOR_ROLES=Object.freeze(['viewer','editor']);
/** The {user} path value for one people row: its user id, else @username (the proxy refuses / \ % ? # and spaces). */
export function collaboratorPathUser(person){
 if(!record(person))return null;const usable=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\s/\\%?#\u0000-\u001f\u007f]/.test(value)&&value!=='.'&&value!=='..';
 for(const key of ['userId','user_id','uid'])if(usable(person[key]))return person[key];
 for(const key of ['username','handle','userName']){const name=text(person[key]);if(name){const handle=name.startsWith('@')?name:'@'+name;if(usable(handle))return handle;}}
 // A bare `id` last: on a people row it may be a membership id rather than the user.
 return usable(person.id)?person.id:null;
}
const roleOf=person=>{const role=text(person.role||person.access||person.permission).toLowerCase();return role||null;};
const ownerOf=person=>person.isOwner===true||person.owner===true||roleOf(person)==='owner'||text(person.origin).toLowerCase()==='owner';
const selfOf=person=>person.isSelf===true||person.isCaller===true||person.you===true||person.me===true||person.isCurrentUser===true;
/** ProjectShare → {rows, callerRole, canManage}. canManage is false only when the share states the caller is not the owner. */
export function collaboratorRows(share){
 if(!record(share)||!Array.isArray(share.people))throw fail('Freestyle returned unreadable share settings.','collaborators_receipt');
 const rows=share.people.filter(record).map(person=>{const user=collaboratorPathUser(person),handle=text(person.username||person.handle||person.userName),name=text(person.displayName||person.display_name||person.name);
  return{user,role:roleOf(person),owner:ownerOf(person),self:selfOf(person),label:name&&handle?`${name} (@${handle.replace(/^@/,'')})`:name||(handle?'@'+handle.replace(/^@/,''):text(person.email)||user||'Collaborator'),pending:person.pending===true||person.status==='pending'||person.status==='invited'};});
 const stated=text(share.currentUserRole||share.callerRole||share.myRole||share.role||share.yourRole||share.viewerRole).toLowerCase()||rows.find(row=>row.self)?.role||null;
 return{rows,callerRole:stated,canManage:stated===null||stated==='owner',visibility:share.visibility??null,defaultRole:share.defaultRole??null};
}
async function retained(client,operationId,parameters,key){
 const send=()=>client.call(operationId,parameters,{idempotencyKey:key});
 try{return await send();}catch(error){if(!transient(error)&&error?.operationUncertain!==true)throw error;try{return await send();}catch(again){throw Object.assign(again,{operationUncertain:transient(again)||again?.operationUncertain===true});}}
}
const api=client=>{if(typeof client?.call!=='function')throw fail('Collaborators need a Studio API (OAuth) project. Reload the project.','collaborators_unavailable',{dispatched:false});return client;};
const checkShare=(data,projectId)=>{if(!record(data)||!Array.isArray(data.people))throw fail('Freestyle answered without the updated collaborator list.','collaborators_receipt',{operationUncertain:true});if(data.projectId!=null&&data.projectId!==projectId)throw fail('Freestyle answered for another project.','collaborators_receipt',{operationUncertain:true});return data;};
export async function readCollaborators({client,projectId}={}){const result=await api(client).call('getProjectShare',{path:{project_id:projectId}});if(record(result?.data)&&result.data.projectId!=null&&result.data.projectId!==projectId)throw fail('Freestyle returned another project’s share settings.','collaborators_receipt');return collaboratorRows(result?.data);}
export async function setCollaboratorRole({client,projectId,user,role,key=defaultKey()}={}){
 if(!COLLABORATOR_ROLES.includes(role))throw fail('Choose Viewer or Editor.','collaborators_role',{dispatched:false});if(typeof user!=='string'||!user)throw fail('This collaborator has no user id or @username to address.','collaborators_user',{dispatched:false});
 return collaboratorRows(checkShare((await retained(api(client),'setCollaboratorRole',{path:{project_id:projectId,user},body:{role}},key))?.data,projectId));
}
export async function removeCollaborator({client,projectId,user,key=defaultKey()}={}){
 if(typeof user!=='string'||!user)throw fail('This collaborator has no user id or @username to address.','collaborators_user',{dispatched:false});
 return collaboratorRows(checkShare((await retained(api(client),'removeCollaborator',{path:{project_id:projectId,user}},key))?.data,projectId));
}
export function collaboratorsMarkup(state){
 if(state.loading)return'<p role="status">Reading collaborators from Freestyle…</p>';
 const head=state.error?`<p class="logic-collaborators-error" role="alert">${esc(state.error)}</p>`:'';if(!state.rows)return head;
 const note=state.canManage?'':'<p><small>Only the project owner can change roles or remove people.</small></p>';
 if(!state.rows.length)return head+note+'<p>No collaborators yet. Use File ▸ Share ▸ Invite Collaborator… to add one.</p>';
 return head+note+`<table class="logic-collaborators"><tbody>${state.rows.map((row,index)=>{const locked=row.owner||!state.canManage||!row.user||state.busy;return`<tr data-collaborator="${index}"><td>${esc(row.label)}${row.self?' <small>(you)</small>':''}${row.pending?' <small>(invited)</small>':''}</td><td>${row.owner?'Owner':`<select data-collaborator-role="${index}" aria-label="Role of ${esc(row.label)}"${locked?' disabled':''}>${[...new Set([...(row.role&&!COLLABORATOR_ROLES.includes(row.role)?[row.role]:[]),...COLLABORATOR_ROLES])].map(role=>`<option value="${esc(role)}"${role===row.role?' selected':''}>${esc(role[0].toUpperCase()+role.slice(1))}</option>`).join('')}</select>`}</td><td>${row.owner?'':`<button type="button" data-collaborator-remove="${index}"${locked?' disabled':''}>Remove…</button>`}</td></tr>`;}).join('')}</tbody></table>`;
}
/** File ▸ Share ▸ Collaborators… dialog. confirm(row) → Promise<boolean> is asked before every removal. */
export function openCollaboratorsDialog({dialog,client,projectId,confirm,isCurrent=()=>true,toast=()=>{},log=()=>{}}={}){
 if(typeof dialog!=='function'||typeof confirm!=='function')throw new TypeError('openCollaboratorsDialog needs dialog and confirm.');
 const d=dialog('Collaborators','<div class="logic-collaborators-body"></div><button type="button" class="logic-collaborators-refresh">Refresh</button><button type="button" class="cancel">Close</button>');
 const body=d.querySelector('.logic-collaborators-body');let state={loading:true,rows:null,error:null,canManage:true,busy:false};
 const paint=()=>{body.innerHTML=collaboratorsMarkup(state);};
 const guard=()=>{if(!isCurrent())throw fail('The project changed. Reopen Collaborators.','collaborators_scope',{dispatched:false});};
 const adopt=next=>{state={...state,...next,loading:false,busy:false,error:null};paint();};
 const load=async()=>{state={...state,loading:true,error:null};paint();try{guard();const next=await readCollaborators({client,projectId});guard();adopt(next);}catch(error){state={...state,loading:false,busy:false,error:error?.message||String(error)};paint();}return state;};
 const act=async(run,label)=>{state={...state,busy:true,error:null};paint();try{guard();const next=await run();guard();adopt(next);toast(label);}catch(error){log('collaborators-write-failed',{status:error?.status??null,code:error?.code??null});state={...state,busy:false,error:error?.message||String(error)};paint();if(error?.operationUncertain)await load();}};
 body.addEventListener('change',event=>{const select=event.target.closest?.('[data-collaborator-role]');if(!select)return;const row=state.rows?.[Number(select.dataset.collaboratorRole)];if(!row||select.value===row.role)return;const role=select.value;act(()=>setCollaboratorRole({client,projectId,user:row.user,role}),`${row.label} is now ${role==='editor'?'an editor':'a viewer'}.`);});
 body.addEventListener('click',async event=>{const button=event.target.closest?.('[data-collaborator-remove]');if(!button)return;const row=state.rows?.[Number(button.dataset.collaboratorRemove)];if(!row)return;if(!await confirm(row))return;await act(()=>removeCollaborator({client,projectId,user:row.user}),`${row.label} no longer has access to this project.`);});
 d.querySelector('.logic-collaborators-refresh').onclick=()=>load();d.querySelector('.cancel').onclick=()=>d.close();
 d.ready=load();return d;
}

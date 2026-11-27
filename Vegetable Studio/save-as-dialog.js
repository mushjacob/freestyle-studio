const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Save As creates a separate cloud project; it never renames the source. */
export function openSaveAsDialog({engine,getProject,dialog,openLibrary,onStatus=()=>{}}){
 if(!engine.ready)return openLibrary();
 const source={projectId:engine.projectId,trackId:engine.session.trackId,version:engine.loadVersion};
 const project=getProject(),name=`${project.title||'Vegetable Studio session'} copy`.slice(0,255);
 const d=dialog('Save as',`<form class="save-as-form"><label for="save-as-name">Project name</label><input id="save-as-name" name="title" maxlength="255" required value="${escape(name)}"><p class="save-as-status" role="status">Create a separate project in your Freestyle library.</p><button type="submit" class="primary save-as-submit">Save copy</button><button type="button" class="save-as-close">Close</button><div class="save-as-recovery"></div></form>`);
 const form=d.querySelector('form'),input=d.querySelector('input'),button=d.querySelector('.save-as-submit'),status=d.querySelector('.save-as-status'),recovery=d.querySelector('.save-as-recovery');
 let submitted=false;
 d.querySelector('.save-as-close').onclick=()=>d.close();input.select();
 form.onsubmit=async event=>{
  event.preventDefault();if(submitted)return;
  if(!engine.ready||engine.loading||engine.projectId!==source.projectId||engine.session.trackId!==source.trackId||engine.loadVersion!==source.version){status.textContent='The project changed. Close and reopen Save as.';button.disabled=true;return;}
  const title=input.value.trim();if(!title)return;
  submitted=true;button.disabled=true;input.disabled=true;status.textContent='Saving a project copy in Freestyle…';
  try{await engine.duplicate(title);onStatus('Project copy saved in Freestyle.');if(d.isConnected)d.close();}
  catch(error){
   if(!d.isConnected)return;
   status.textContent=error.duplicateProjectId?`The copy was created. ${error.message}`:`${error.message} Check your cloud projects before submitting another copy.`;
   // Retrying the open uses the returned identity, never another duplicate call.
   if(error.duplicateProjectId){const open=d.ownerDocument.createElement('button');open.type='button';open.textContent='Open saved copy';open.className='save-as-open-copy';open.onclick=async()=>{open.disabled=true;try{await engine.load(error.duplicateProjectId);d.close();}catch(failure){status.textContent=failure.message;open.disabled=false;}};recovery.append(open);}
   const browse=d.ownerDocument.createElement('button');browse.type='button';browse.textContent='Open cloud projects';browse.className='save-as-library';browse.onclick=()=>{d.close();openLibrary();};recovery.append(browse);
  }
 };
 return d;
}

/** FL's "Save new version": `Song` becomes `Song_2`, `Song_2` becomes `Song_3`. */
export function nextVersionTitle(title){
 const text=String(title??'').trim()||'Vegetable Studio session',match=/^(.*\S)_(\d+)$/.exec(text);
 const base=match?match[1]:text,number=match?Number(match[2])+1:2,suffix=`_${number}`;
 return `${base.slice(0,Math.max(1,255-suffix.length))}${suffix}`;
}

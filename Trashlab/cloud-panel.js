import {studioCompatibleRequest} from './studio-api-bridge.js';
import {hostFetch,freestyleHost,freestyleOrigin} from './freestyle-host-transport.js';
/** Freestyle MCP workstation. Tool schemas are discovered from the authenticated server. */
let panel, status = { connected: false }, tools = [], selectedTool = null, selectedCategory = 'All tools';
const sessionValue = key => { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } };
let projectId = sessionValue('illogic:cloud-project');
let trackId = sessionValue('illogic:cloud-track');
/** Inside Freestyle the project is the one open in Studio; this panel never picks another. */
const hostProjectId = () => { try { return String(freestyleHost()?.getProjectId?.() || ''); } catch { return ''; } };
const embeddedHost = () => !!freestyleHost();
let refreshTimer, requestInFlight = false, lastResult = null;
const selectedUploads = new Map();
const FILE_ARGUMENT = '<selected file bytes>';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
let uploadRevision = 0, uploadReading = false;
const $ = (selector) => panel.querySelector(selector);
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
const pretty = (value) => JSON.stringify(value, null, 2);
const safeUrl = (value) => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
function event(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
async function api(path, body) {
  const response = await hostFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error([data.error, data.detail].filter(Boolean).map(v => typeof v === 'string' ? v : pretty(v)).join(' — ') || `HTTP ${response.status}`);
  return data;
}
export async function getCloudStatus() { status = await api('/api/status'); event('vegetable-cloud-status', status); return status; }
export async function cloudCall(name, args = {}) { const {response,data,request}=await studioCompatibleRequest(name,args);if(!response.ok){const detail=typeof data.error==='object'?data.error:data;throw Object.assign(new Error(detail.message||data.detail||data.error||`HTTP ${response.status}`),detail,{status:response.status,result:data,studioRequest:request,explicitRejection:response.status<500&&detail.stage!=='engine_dispatch',operationUncertain:response.status>=500||detail.stage==='engine_dispatch'});}return data; }
export function getCloudProject() { return { projectId, trackId }; }
// Embedded: mirror the host's project into the panel without dispatching a load
// (freestyle-embed.js loads it); the panel never navigates on its own.
try { freestyleHost()?.on?.('project', next => { const id = String(next?.id || ''); if (id === projectId) return; projectId = id; trackId = ''; try { sessionStorage.setItem('illogic:cloud-project', projectId); sessionStorage.setItem('illogic:cloud-track', ''); } catch {} if (panel) { $('#cloud-project-id').value = projectId; $('#cloud-track-id').value = ''; } }); } catch {}
window.addEventListener('vegetable-cloud-published', e => {
  if (e.detail?.projectId) setProject(e.detail.projectId,e.detail.trackId || '');
});
function payload(result) {
  if (result.structuredContent) return result.structuredContent;
  const blocks = result.content?.filter(x => x.type === 'text').map(x => x.text) || [];
  try { return JSON.parse(blocks.join('\n')); } catch { return result; }
}
function setProject(id, track = trackId) {
  // Embedded: a tool result naming another project never switches this view; the host decides.
  if (embeddedHost() && hostProjectId() && (id || '') !== hostProjectId()) { if ((id || '') !== projectId && panel) $('#cloud-call-state').textContent = 'Trashlab follows the project open in Freestyle Studio.'; return; }
  projectId = id || ''; trackId = track || '';
  try { sessionStorage.setItem('illogic:cloud-project', projectId); sessionStorage.setItem('illogic:cloud-track', trackId); } catch {}
  if (panel) { $('#cloud-project-id').value = projectId; $('#cloud-track-id').value = trackId; $('#cloud-open-studio').hidden = !projectId || embeddedHost(); $('#cloud-open-studio').href = `${freestyleOrigin()}/${encodeURIComponent(projectId)}/studio`; }
  event('vegetable-cloud-project', { projectId, trackId });
}
function category(tool) {
  const n = tool.name;
  if (/plugin|effect|preset|gain|mixer/.test(n)) return 'Mixer & effects';
  if (/transport|pro_action|pro_state|capabilit|pattern|midi|note|lane|track/.test(n)) return 'DAW & MIDI';
  if (/mozart|music_model|generat|voice_model|template/.test(n)) return 'AI & instruments';
  if (/export|listen|audio|media|upload|import/.test(n)) return 'Audio & export';
  if (/project|save|backing|beat|youtube/.test(n)) return 'Projects & library';
  return 'Account & other';
}
function button(text, onClick, cls = '') { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', onClick); return b; }
function createPanel() {
  panel = document.createElement('dialog'); panel.id = 'cloud-panel'; panel.className = 'cloud-panel';
  panel.innerHTML = `<header class="cloud-title"><span class="cloud-icon">☁</span><strong>Freestyle cloud engine</strong><span id="cloud-connection" class="cloud-connection">Checking connection…</span><button type="button" id="cloud-close" aria-label="Close cloud engine">×</button></header>
  <div class="cloud-connect-bar"><span id="cloud-connect-copy">Connect your Freestyle Pro account to use the cloud DAW.</span><button type="button" id="cloud-connect">Connect Freestyle</button><button type="button" id="cloud-refresh">Refresh</button><a href="https://freestyle.audio/docs/quickstart.html" target="_blank" rel="noopener noreferrer">API docs ↗</a></div>
  <div class="cloud-project-bar"><label>Project <input id="cloud-project-id" placeholder="Select or create a cloud project" autocomplete="off"></label><label>Track / lane <input id="cloud-track-id" placeholder="Optional context" autocomplete="off"></label><button type="button" id="cloud-project-list">Projects</button><button type="button" id="cloud-project-new">New project</button><a id="cloud-open-studio" target="_blank" rel="noopener noreferrer" hidden>Open studio ↗</a></div>
  <div id="cloud-projects" class="cloud-projects" hidden></div>
  <div class="cloud-shortcuts" aria-label="Cloud project actions"></div>
  <main class="cloud-workspace"><aside class="cloud-tools"><input id="cloud-search" type="search" placeholder="Search every available tool…" aria-label="Search cloud tools"><select id="cloud-category" aria-label="Tool category"><option>All tools</option></select><div id="cloud-tool-count" class="cloud-tool-count"></div><div id="cloud-tool-list" class="cloud-tool-list"></div></aside>
  <section class="cloud-tool-editor"><div id="cloud-tool-heading"><h2>Connect the cloud engine</h2><p>This control surface runs the Freestyle cloud DAW. Browse its tools here; authorize access to run them.</p></div><form id="cloud-tool-form"><div id="cloud-fields"></div><details class="cloud-raw"><summary>Advanced: raw JSON arguments</summary><label><input id="cloud-use-json" type="checkbox"> Use JSON instead of form fields</label><textarea id="cloud-json" spellcheck="false" aria-label="Tool JSON arguments">{}</textarea></details><div class="cloud-run-row"><button id="cloud-run" type="submit" disabled>Run tool</button><span id="cloud-call-state" role="status"></span></div></form><div class="cloud-output-head"><strong>Result</strong><button type="button" id="cloud-download-result" disabled>Save JSON</button></div><div id="cloud-media" class="cloud-media"></div><pre id="cloud-result" tabindex="0">No cloud tool has run yet.</pre></section></main>
  <footer class="cloud-footer"><span>Cloud calls use your Freestyle account and its usage limits.</span><span>Transport, instruments, editing, mixing and rendering run in Freestyle.</span></footer>`;
  document.body.appendChild(panel);
  $('#cloud-close').onclick = () => panel.close();
  panel.addEventListener('click', e => { if (e.target === panel && (e.clientX < panel.getBoundingClientRect().left || e.clientX > panel.getBoundingClientRect().right || e.clientY < panel.getBoundingClientRect().top || e.clientY > panel.getBoundingClientRect().bottom)) panel.close(); });
  panel.addEventListener('close', () => { clearTimeout(refreshTimer); clearUploads(); });
  $('#cloud-connect').onclick = connect;
  $('#cloud-refresh').onclick = () => refresh(true);
  $('#cloud-search').oninput = renderTools;
  $('#cloud-category').onchange = e => { selectedCategory = e.target.value; renderTools(); };
  $('#cloud-project-id').onchange = e => setProject(e.target.value.trim(), '');
  $('#cloud-track-id').onchange = e => setProject(projectId, e.target.value.trim());
  $('#cloud-project-list').onclick = loadProjects;
  $('#cloud-project-new').onclick = () => chooseTool('create_project');
  $('#cloud-tool-form').onsubmit = runSelected;
  $('#cloud-use-json').onchange = () => { const raw = $('#cloud-use-json').checked; if (raw) { try { $('#cloud-json').value = pretty(displayArguments(readFields())); } catch {} } $('#cloud-fields').querySelectorAll('input,select,textarea').forEach(input => { input.disabled = raw; }); };
  $('#cloud-download-result').onclick = () => { const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([pretty(lastResult)], { type: 'application/json' })); a.href = url; a.download = `freestyle-${selectedTool?.name || 'result'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const shortcuts = $('.cloud-shortcuts');
  for (const [label, name, args] of [ ['▶ Cloud play', 'transport_control', {command:'play'}], ['Ⅱ Pause', 'transport_control', {command:'pause'}], ['■ Stop', 'transport_control', {command:'stop'}], ['Project state', 'get_project', {}], ['Live engine', 'get_pro_state', {}], ['Add lane', 'create_track', {}], ['Mozart AI', 'mozart_ai_command', {}], ['Listen', 'listen_to_project', {}], ['Export mix', 'export_mix', {}] ]) shortcuts.append(button(label, () => { chooseTool(name, args); if (name === 'transport_control' && projectId && status.connected && !requestInFlight) execute(name,{project_id:projectId,...(trackId ? {track_id:trackId}:{}),...args}); }));
  if (embeddedHost()) {
    // No sign-in or project picker inside Freestyle: the session and project come from Studio.
    for (const id of ['#cloud-connect', '#cloud-project-list', '#cloud-project-new']) $(id).hidden = true;
    for (const id of ['#cloud-project-id', '#cloud-track-id']) $(id).readOnly = true;
    const hosted = hostProjectId(); if (hosted && hosted !== projectId) { projectId = hosted; trackId = ''; }
  }
  window.addEventListener('focus', () => { if (panel.open) refresh(false); });
  setProject(projectId, trackId);
}
// Standalone (freestyle-standalone-host.js): the Freestyle button opens the project picker.
/** Open the cloud engine panel; `tool` (e.g. 'mozart_ai_command' for the Assistant) selects that tool once the list is loaded. */
export async function openCloudPanel({ tool = null } = {}) { const standalone = globalThis.__freestyleStudioHost; if (!tool && standalone?.mode === 'standalone' && typeof standalone.showProjectPicker === 'function') return standalone.showProjectPicker(); if (!panel) createPanel(); if (!panel.open) panel.showModal(); await refresh(false); if (typeof tool === 'string' && tool) chooseTool(tool); }
/** Freestyle Studio already holds the session; "connect" only re-reads its status. */
async function connect() { await refresh(true); }
async function refresh(force) {
  try {
    const previous = status.connected; await getCloudStatus();
    $('#cloud-connection').textContent = status.connected ? '● Connected' : '○ Not connected';
    $('#cloud-connection').classList.toggle('connected', !!status.connected);
    $('#cloud-connect').hidden = !!status.connected || embeddedHost();
    $('#cloud-connect-copy').textContent = status.connected ? `Freestyle connected${status.username ? ` as ${status.username}` : ''}. Select a project or use any tool below.` : 'Connect your Freestyle Pro account to use the cloud DAW.';
    if (!tools.length || force || status.connected !== previous) {
      const response = await api(force?'/api/tools?refresh=1':'/api/tools'); tools = response.tools || [];
      const options = ['All tools', ...[...new Set(tools.map(category))].sort()];
      $('#cloud-category').replaceChildren(...options.map(x => { const o = el('option', x); o.value = x; return o; }));
      if (options.includes(selectedCategory)) $('#cloud-category').value = selectedCategory;
      renderTools();
      if (!selectedTool && tools.length) selectTool(tools.find(t => t.name === 'whoami') || tools[0]);
      else if (selectedTool) selectTool(tools.find(t => t.name === selectedTool.name) || tools[0]);
    }
    $('#cloud-run').disabled = !status.connected || requestInFlight || uploadReading;
  } catch (error) { showError(error); }
}
function renderTools() {
  const query = $('#cloud-search').value.toLowerCase();
  const filtered = tools.filter(t => (selectedCategory === 'All tools' || category(t) === selectedCategory) && `${t.name} ${t.title || ''} ${t.description || ''}`.toLowerCase().includes(query));
  $('#cloud-tool-count').textContent = tools.length ? `${filtered.length} of ${tools.length} ${status.connected ? 'available tools' : 'documented tools'}` : 'Sign in to discover available tools';
  const items = filtered.map(t => { const b = button(t.title || t.name.replaceAll('_', ' '), () => selectTool(t), 'cloud-tool-item'); b.title = t.description || t.name; b.classList.toggle('selected', selectedTool?.name === t.name); b.append(el('small', t.name)); return b; });
  $('#cloud-tool-list').replaceChildren(...items);
}
function chooseTool(name, args = {}) {
  const tool = tools.find(t => t.name === name);
  if (!tool) { $('#cloud-call-state').textContent = status.connected ? `${name} is not exposed for this account.` : 'Connect Freestyle to use cloud tools.'; return; }
  selectTool(tool, args);
}
function clearUploads() {
  uploadRevision++; uploadReading = false;
  if (panel) { try { const args=JSON.parse($('#cloud-json').value); for (const [key,value] of Object.entries(args)) if(value===FILE_ARGUMENT) delete args[key]; $('#cloud-json').value=pretty(args); } catch {} }
  selectedUploads.clear();
  if (!panel) return;
  panel.querySelectorAll('[data-upload-field]').forEach(input => { input.value = ''; });
  panel.querySelectorAll('.cloud-upload-status').forEach(node => { node.textContent = 'Up to 25 MB. File bytes stay in memory until you run the tool.'; });
}
function displayArguments(args) {
  const visible = {...args};
  for (const key of selectedUploads.keys()) if (key in visible) visible[key] = FILE_ARGUMENT;
  return visible;
}
function hydrateArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  for (const [key,value] of Object.entries(args)) if (value === FILE_ARGUMENT) { if (!selectedUploads.has(key)) throw new Error('Choose the file again before running this upload.'); args[key] = selectedUploads.get(key).data; }
  return args;
}
function argumentInput(key) {
  const field = Array.from($('#cloud-fields').children).find(node => node.dataset.key === key);
  return field?.querySelector('input,select,textarea');
}
function uploadField(label,key,schema,required) {
  label.classList.add('wide','cloud-upload-field');
  const input = el('input'); input.type = 'file'; input.name = key; input.required = required; input.dataset.uploadField = 'true';
  input.accept = selectedTool.name === 'import_daw_project' ? '.flp,.zip,.logicx' : 'audio/*,.wav,.mp3,.flac,.aiff,.aif,.m4a,.ogg,.webm';
  input.setAttribute('aria-label',selectedTool.name === 'import_daw_project' ? 'Choose FL Studio project or zipped Logic project' : 'Choose audio file');
  const note = el('small','Up to 25 MB. File bytes stay in memory until you run the tool.','cloud-upload-status');
  input.onchange = async () => {
    const file = input.files?.[0], revision = ++uploadRevision; selectedUploads.delete(key);
    if (!file) { note.textContent = 'Choose a file to attach.'; return; }
    if (file.size > MAX_UPLOAD_BYTES) { input.value = ''; note.textContent = 'This file exceeds Freestyle’s 25 MB upload limit.'; showError(new Error(note.textContent)); return; }
    if (!file.size) { input.value = ''; note.textContent = 'This file is empty.'; showError(new Error(note.textContent)); return; }
    uploadReading = true; $('#cloud-run').disabled = true; note.textContent = `Reading ${file.name}…`;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
      for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      if (revision !== uploadRevision) return;
      selectedUploads.set(key,{data:btoa(binary),filename:file.name});
      const props = selectedTool.inputSchema?.properties || {};
      if (props.filename) { const field = argumentInput('filename'); if (field) field.value = file.name.slice(0,props.filename.maxLength || 160); }
      for (const mimeKey of ['mime_type','mimeType','content_type','contentType']) if (props[mimeKey] && file.type) { const field=argumentInput(mimeKey); if (field) field.value=file.type; }
      if (selectedTool.name === 'import_daw_project' && props.format) {
        const format = /\.flp$/i.test(file.name) ? 'flp' : /\.logicx(?:\.zip)?$/i.test(file.name) ? 'logic' : null;
        if (format && (!props.format.enum || props.format.enum.includes(format))) { const field=argumentInput('format'); if (field) field.value=format; }
      }
      note.textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB ready. Click Run tool to upload.${selectedTool.name === 'import_daw_project' && /\.zip$/i.test(file.name) ? ' Check the project format for this ZIP.' : ''}`;
      $('#cloud-json').value = pretty(displayArguments(readFields()));
      $('#cloud-call-state').textContent = 'File loaded locally. It has not been uploaded yet.';
      $('#cloud-call-state').classList.remove('cloud-error');
    } catch(error) { if (revision === uploadRevision) { input.value=''; showError(error); note.textContent='Could not read this file.'; } }
    finally { if (revision === uploadRevision) { uploadReading=false; $('#cloud-run').disabled=!status.connected || requestInFlight; } }
  };
  label.append(input,note);
  if (schema.description) label.append(el('small',schema.description));
  return label;
}
function fieldFor(key, schema, required, preset) {
  const label = el('label', null, 'cloud-field'); label.dataset.key = key; label.dataset.type = schema.type || 'string';
  label.append(el('span', `${key}${required ? ' *' : ''}`));
  let input;
  if (key === 'base64' && ['import_daw_project','upload_audio'].includes(selectedTool?.name)) return uploadField(label,key,schema,required);
  if (Array.isArray(schema.enum)) { input = el('select'); if (!required) input.append(new Option('Not set', '')); for (const v of schema.enum) input.append(new Option(String(v), String(v))); }
  else if (schema.type === 'boolean') { input = el('select'); input.append(new Option(required ? 'False' : 'Not set', required ? 'false' : ''), new Option('True', 'true')); if (!required) input.append(new Option('False', 'false')); }
  else if (schema.type === 'object' || schema.type === 'array' || schema.oneOf || schema.anyOf) { input = el('textarea'); input.spellcheck = false; input.rows = 4; input.placeholder = schema.type === 'array' ? '[]' : '{}'; label.classList.add('wide'); }
  else { input = el('input'); input.type = ['integer','number'].includes(schema.type) ? 'number' : 'text'; if (schema.type === 'integer') input.step = '1'; else if (schema.type === 'number') input.step = 'any'; for (const [k, attr] of [['minimum','min'],['maximum','max'],['minLength','minLength'],['maxLength','maxLength']]) if (schema[k] !== undefined) input[attr] = schema[k]; }
  input.name = key; input.required = required;
  const value = preset ?? (key === 'project_id' ? projectId : key === 'track_id' || key === 'lane_id' ? trackId : undefined) ?? schema.default;
  if (value !== undefined) input.value = typeof value === 'object' ? pretty(value) : String(value);
  label.append(input);
  if (schema.description) label.append(el('small', schema.description));
  return label;
}
function selectTool(tool, presets = {}) {
  clearUploads();
  selectedTool = tool;
  const heading = $('#cloud-tool-heading'); heading.replaceChildren(el('h2', tool.title || tool.name.replaceAll('_', ' ')), el('code', tool.name), el('p', tool.description || ''));
  const schema = tool.inputSchema || { type:'object', properties:{} };
  const required = new Set(schema.required || []);
  $('#cloud-fields').replaceChildren(...Object.entries(schema.properties || {}).map(([k,s]) => fieldFor(k,s,required.has(k),presets[k])));
  $('#cloud-use-json').checked = false;
  try { $('#cloud-json').value = pretty(displayArguments(readFields())); } catch { $('#cloud-json').value = pretty(presets); }
  $('#cloud-run').disabled = !status.connected || requestInFlight || uploadReading;
  $('#cloud-run').textContent = tool.annotations?.readOnlyHint ? 'Read from Freestyle' : 'Run tool';
  $('#cloud-call-state').textContent = tool.annotations?.destructiveHint ? 'This tool may modify or delete data. Review its arguments before running.' : '';
  renderTools();
}
function readFields() {
  const args = {};
  for (const field of $('#cloud-fields').children) {
    const input = field.querySelector('input,select,textarea'), raw = input.value.trim(), key = field.dataset.key, type = field.dataset.type;
    if (input.dataset.uploadField) { if (selectedUploads.has(key)) args[key] = selectedUploads.get(key).data; continue; }
    if (!raw) continue;
    try { args[key] = type === 'boolean' ? raw === 'true' : ['number','integer'].includes(type) ? Number(raw) : ['object','array'].includes(type) || input.tagName === 'TEXTAREA' ? JSON.parse(raw) : input.value; }
    catch { throw new Error(`${key} must be valid JSON.`); }
    if (['number','integer'].includes(type) && (!Number.isFinite(args[key]) || (type === 'integer' && !Number.isInteger(args[key])))) throw new Error(`${key} must be a valid ${type}.`);
  }
  return args;
}
async function runSelected(e) {
  e.preventDefault(); if (!selectedTool || requestInFlight || uploadReading) return;
  let args;
  try { args = $('#cloud-use-json').checked ? hydrateArguments(JSON.parse($('#cloud-json').value)) : readFields(); if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('Arguments must be a JSON object.'); }
  catch (error) { showError(error); return; }
  const name = selectedTool.name;
  await execute(name,args);
}
async function execute(name, args) {
  requestInFlight = true; $('#cloud-run').disabled = true; $('#cloud-call-state').textContent = `Running ${name}…`;
  try {
    const result = await cloudCall(name,args); showResult(result); const data = payload(result);
    // Freestyle ▸ Assistant follows a Mozart AI job (or re-reads the project) from here.
    try { event('vegetable-cloud-result', { name, args, result }); } catch {}
    if (result.isError) $('#cloud-call-state').textContent = 'Freestyle returned a tool error. See the result below.';
    else { $('#cloud-call-state').textContent = 'Complete'; if (name === 'create_project' && data.project?.id) setProject(data.project.id,''); }
    if (args.project_id && !result.isError) setProject(args.project_id,args.track_id || trackId);
    if (name === 'get_project' && !result.isError) {
      const p = data.project || data;
      const firstTrack = p.tracks?.[0] || p.lanes?.[0] || p.audioClips?.[0] || p.takes?.[0];
      if (firstTrack?.id) setProject(args.project_id, firstTrack.id);
    }
    return result;
  } catch (error) { showError(error); }
  finally { requestInFlight = false; $('#cloud-run').disabled = !status.connected; }
}
function showError(error) { if (!panel) return; $('#cloud-call-state').textContent = error.message || String(error); $('#cloud-call-state').classList.add('cloud-error'); }
function showResult(result) {
  lastResult = result; $('#cloud-download-result').disabled = false; $('#cloud-call-state').classList.remove('cloud-error'); $('#cloud-result').textContent = pretty(payload(result));
  const media = $('#cloud-media'); media.replaceChildren();
  const urls = new Map();
  function scan(value, key = '') {
    if (!value || typeof value !== 'object') return;
    for (const [k,v] of Object.entries(value)) {
      if (typeof v === 'string' && safeUrl(v) && /url|audio|download|link/i.test(k)) urls.set(v,k);
      else if (v && typeof v === 'object') scan(v,k);
    }
  }
  scan(payload(result));
  for (const [url,key] of urls) {
    if (/playback|audio/i.test(key) || /\.(mp3|wav|ogg|m4a|webm)(\?|$)/i.test(url)) { const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = url; media.append(audio); }
    const a = el('a', `${key.replace(/([A-Z])/g,' $1')} ↗`); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; media.append(a);
  }
  for (const block of result.content || []) if (block.type === 'audio' && block.data && /^audio\//.test(block.mimeType)) { const audio = document.createElement('audio'); audio.controls = true; audio.src = `data:${block.mimeType};base64,${block.data}`; media.append(audio); }
}
async function loadProjects() {
  if (!status.connected) { $('#cloud-call-state').textContent = 'Connect Freestyle to load projects.'; return; }
  const tool = tools.find(t => t.name === 'list_projects'); if (!tool) return;
  selectTool(tool); const result = await execute('list_projects',{limit:50}); if (!result || result.isError) return;
  const data = payload(result); const projects = Array.isArray(data) ? data : data.projects || data.items || data.data?.projects || [];
  const container = $('#cloud-projects'); container.replaceChildren(); container.hidden = false;
  if (!projects.length) container.append(el('span', 'No projects returned. Create a blank project to begin.'));
  for (const p of projects) {
    const id = p.id || p.projectId; if (!id) continue;
    container.append(button(`${p.title || p.name || 'Untitled'} · ${p.bpm || '—'} BPM`, () => { setProject(id,''); container.hidden = true; chooseTool('get_project',{project_id:id}); }, 'cloud-project-item'));
  }
  container.append(button('Close list', () => {container.hidden=true;}, 'cloud-project-dismiss'));
}

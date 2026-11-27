/** Inspect a failed local preview ticket once; never prepare or replay audio. */
const TICKET=/^\/api\/media\/[A-Za-z0-9_-]{20,128}$/;
const LIMIT=8192;
const cancel=body=>{try{Promise.resolve(body?.cancel?.()).catch(()=>{});}catch{}};
function safeDetail(value){
 if(typeof value!=='string')return null;
 const text=value.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'()]+/gi,'[URL omitted]')
  .replace(/\b[a-z][a-z\d+.-]*%3a%2f%2f[^\s<>"'()]+/gi,'[URL omitted]')
  .replace(/\/\/[^\s<>"'()]+/g,'[URL omitted]')
  .replace(/\/api\/media\/[A-Za-z0-9_-]+(?:\?[^\s<>"'()]*)?/g,'[preview ticket]')
  .replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim();
 if(!text)return null;const detail=text.length>320?text.slice(0,320).trimEnd()+'…':text;
 return /[.!?…]$/.test(detail)?detail:detail+'.';
}
async function readLimited(response,limit,signal,setReader){
 const length=response.headers?.get?.('content-length');
 if(length!=null&&(!/^\d+$/.test(length)||Number(length)>limit)){cancel(response.body);return null;}
 if(response.body?.getReader){
  const reader=response.body.getReader();setReader(reader);const chunks=[];let total=0;
  try{
   while(!signal.aborted){const {done,value}=await reader.read();if(done){const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;}
    if(!(value instanceof Uint8Array)||value.byteLength>limit-total)return null;chunks.push(value);total+=value.byteLength;
   }
   return null;
  }finally{cancel(reader);try{reader.releaseLock();}catch{}setReader(null);}
 }
 // Real fetch responses provide a stream (or a null empty body). This fallback
 // supports already-materialized text-only test fixtures, never a live stream.
 if(response.body===undefined&&typeof response.text==='function'){
  const text=await response.text();if(typeof text!=='string'||text.length>limit||signal.aborted)return null;const bytes=new TextEncoder().encode(text);return bytes.byteLength<=limit?bytes:null;
 }
 cancel(response.body);return null;
}

export async function inspectLibraryPreviewError(url,{fetch:fetchImpl=globalThis.fetch,timeoutMs=5000,maxBytes=8192}={}){
 if(typeof url!=='string'||url!==url.trim()||!TICKET.test(url)||typeof fetchImpl!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>2147483647||!Number.isInteger(maxBytes)||maxBytes<=0)return null;
 const controller=new AbortController(),limit=Math.min(LIMIT,maxBytes);let reader=null,timer;
 const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();cancel(reader);resolve(null);},timeoutMs);});
 const inspect=(async()=>{
  const response=await fetchImpl(url,{method:'GET',headers:{Range:'bytes=0-0'},cache:'no-store',redirect:'error',signal:controller.signal});
  if(controller.signal.aborted){cancel(response?.body);return null;}
  const status=response?.status;
  if(status===200||status===206){cancel(response.body);return null;}
  const type=response?.headers?.get?.('content-type')||'';
  if(!Number.isInteger(status)||status<400||status>599||!/^application\/(?:[\w.-]+\+)?json(?:\s*;|\s*$)/i.test(type)){cancel(response?.body);return null;}
  const bytes=await readLimited(response,limit,controller.signal,value=>{reader=value;});if(!bytes||controller.signal.aborted)return null;
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),detail=safeDetail(data?.detail);if(!detail)return null;
  return `Freestyle rejected this sound preview (HTTP ${status}): ${detail}`;
 })();
 try{return await Promise.race([inspect,timeout]);}catch{return null;}finally{clearTimeout(timer);controller.abort();cancel(reader);}
}

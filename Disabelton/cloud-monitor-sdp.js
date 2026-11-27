/** Stereo-Opus SDP policy for the monitor offer.
 * Preserve browser credentials, DTLS, codecs and every unrelated SDP line.
 */
export function nativeStereoOpusOffer(sdp){
 const value=String(sdp||''),payload=value.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2\s*$/im)?.[1];
 if(!payload)return value;
 const settings=['stereo=1','sprop-stereo=1','maxplaybackrate=48000','maxaveragebitrate=510000'];
 const format=parameters=>[...parameters.split(';').map(item=>item.trim()).filter(Boolean).filter(item=>!/^(stereo|sprop-stereo|maxplaybackrate|maxaveragebitrate)=/i.test(item)),...settings].join(';');
 const existing=new RegExp(`^a=fmtp:${payload} ([^\\r\\n]*)$`,'im');
 if(existing.test(value))return value.replace(existing,(_line,parameters)=>`a=fmtp:${payload} ${format(parameters)}`);
 const mapping=new RegExp(`^(a=rtpmap:${payload}\\s+opus/48000/2)[ \\t]*(\\r?\\n|$)`,'im');
 return value.replace(mapping,(_line,rtpmap,ending)=>`${rtpmap}${ending||'\r\n'}a=fmtp:${payload} ${format('')}${ending}`);
}

export function nativeAllowTailnetCandidates(environment=globalThis){
 try{return environment?.__FS_ICE_ALLOW_TAILNET===true||environment?.localStorage?.getItem?.('freestyle_ice_allow_tailnet')==='1';}catch{return false;}
}
function tailnetAddress(address){
 let value=String(address||'').trim().toLowerCase();
 if(value.startsWith('[')&&value.includes(']'))value=value.slice(1,value.indexOf(']'));
 value=value.split('%')[0];if(value.startsWith('::ffff:')&&value.includes('.'))value=value.slice(7);
 if(!value.includes(':')){
  const match=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if(!match)return false;const octets=match.slice(1).map(Number);
  return octets.every(item=>item<=255)&&octets[0]===100&&octets[1]>=64&&octets[1]<=127;
 }
 const parts=value.split(':'),prefix=['fd7a','115c','a1e0'];
 return parts.length>=3&&prefix.every((part,index)=>/^[0-9a-f]{1,4}$/.test(parts[index])&&parts[index].replace(/^0+(?=.)/,'')===part);
}
function tailnetHost(line){
 const candidate=/^(?:a=)?candidate:(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/i.exec(line.trim());
 return !!candidate&&candidate[7].toLowerCase()==='host'&&(tailnetAddress(candidate[5])||/\b(?:utun\d*|tailscale\d*)\b/i.test(line));
}
/** Remove unusable tailnet hosts only when some other ICE route remains. */
export function nativeFilterIceSdp(sdp,{allowTailnet=false}={}){
 const value=String(sdp||''),lines=value.match(/[^\n]*\n|[^\n]+$/g)||[];
 let removed=0,kept=0;const filtered=[];
 for(const line of lines){
  if(/^a=candidate:/i.test(line)){
   if(!allowTailnet&&tailnetHost(line)){removed++;continue;}
   kept++;
  }
  filtered.push(line);
 }
 if(removed&&kept===0)return{sdp:value,removed:0,kept:0,allTailnet:true};
 return{sdp:removed?filtered.join(''):value,removed,kept,allTailnet:false};
}

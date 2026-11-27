import assert from 'node:assert/strict';
import {encodeMidi,decodeMidi,compileProjectEvents,midiPpqn} from './midi.js';
const bytes16=n=>[n>>8,n&255],bytes32=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255];
const vlq=n=>{const out=[n&127];while(n>>>=7)out.unshift((n&127)|128);return out;};
const fixture=(events,division=480)=>{
 const body=[];for(const [delta,data] of events)body.push(...vlq(delta),...data);
 body.push(0,255,47,0);
 return new Uint8Array([...Buffer.from('MThd'),0,0,0,6,0,0,0,1,...bytes16(division),...Buffer.from('MTrk'),...bytes32(body.length),...body]).buffer;
};
const project={title:'Polyphonic garden',bpm:120,master:.8,selectedPattern:'p',
 channels:[{id:'piano',name:'Piano',type:'keys',volume:.8,pan:-.5},{id:'kick',name:'Kick',type:'kick'}],
 patterns:[{id:'p',bars:1,steps:{kick:[true,false,false,false,true]},notes:{piano:[{pitch:60,start:0,duration:1,velocity:.7},{pitch:64,start:0,duration:2,velocity:.8},{pitch:67,start:1,duration:1,velocity:.9}]}}],
 clips:[{patternId:'p',start:4,length:4}]};
const blob=encodeMidi(project); assert.equal(blob.type,'audio/midi');
const encoded=await blob.arrayBuffer();assert.equal(Buffer.from(encoded).subarray(0,4).toString(),'MThd');
const decoded=decodeMidi(encoded);
assert.equal(decoded.title,project.title);assert.equal(decoded.bpm,120);assert.equal(decoded.patterns[0].bars,2);
assert.equal(decoded.channels.length,2);
const piano=decoded.channels.find(channel=>channel.type==='keys');
assert.deepEqual(decoded.patterns[0].notes[piano.id].map(note=>[note.pitch,note.start,note.duration]),[[60,4,1],[64,4,2],[67,5,1]]);
const kick=decoded.channels.find(channel=>channel.type==='kick');
assert.deepEqual(decoded.patterns[0].notes[kick.id].map(note=>[note.pitch,note.start]),[[36,4],[36,5]]);
assert.ok(Math.abs(piano.pan+.5)<.02);
assert.equal(new DataView(encoded).getUint16(12),480);

// Running status, repeated same-pitch polyphony, program changes and velocity-zero note-offs.
const running=decodeMidi(fixture([
 [0,[0xc0,33]], [0,[0x90,48,100]],[120,[48,80]], [120,[48,0]],[120,[0x80,48,0]],
 [0,[0xc0,89]],[0,[0x90,72,100]],[480,[0x80,72,0]],
]));
assert.equal(running.channels.length,2);
assert.equal(running.channels[0].type,'bass');assert.equal(running.channels[1].type,'pad');
const bass=running.patterns[0].notes[running.channels[0].id];
assert.deepEqual(bass.map(note=>[note.start,note.duration]),[[0,.5],[.25,.5]]);

// A tempo change is baked into beat placement so a single-tempo project preserves timing.
const tempo=decodeMidi(fixture([
 [0,[255,81,3,7,161,32]], // 120 bpm
 [0,[0x90,60,100]],[480,[0x80,60,0]],
 [0,[255,81,3,15,66,64]], // 60 bpm
 [0,[0x90,62,100]],[480,[0x80,62,0]],
]));
const tempoNotes=Object.values(tempo.patterns[0].notes)[0];
assert.equal(tempo.bpm,120);assert.deepEqual(tempoNotes.map(note=>[note.start,note.duration]),[[0,1],[1,2]]);

// Sustain pedal extends note duration until pedal release.
const sustain=decodeMidi(fixture([[0,[0x90,60,100]],[0,[0xb0,64,127]],[240,[0x80,60,0]],[240,[0xb0,64,0]]]));
assert.equal(Object.values(sustain.patterns[0].notes)[0][0].duration,1);
const percussion=decodeMidi(fixture([[0,[0x99,45,100]],[120,[0x89,45,0]]]));
const percussionRoundtrip=decodeMidi(await encodeMidi(percussion).arrayBuffer());
assert.equal(Object.values(percussionRoundtrip.patterns[0].notes)[0][0].pitch,45,'unmapped GM percussion pitch survives round-trip');
const highPpq=decodeMidi(fixture([[1,[0x90,60,100]],[1,[0x80,60,0]]],960));
const shortNote=Object.values(highPpq.patterns[0].notes)[0][0];assert.equal(shortNote.start,1/960);assert.equal(shortNote.duration,1/960,'a one-tick 960-PPQ note must not expand to the exporter’s 480-PPQ minimum');
assert.throws(()=>decodeMidi(new ArrayBuffer(2)),/truncated/);
assert.throws(()=>decodeMidi(fixture([],0x8001)),/SMPTE/);
assert.throws(()=>decodeMidi(fixture([[0,[60,100]]])),/running status/);
console.log('MIDI: format-1 round-trip, 480 PPQN, polyphony, drum mapping, running status, program changes, tempo changes, sustain, and invalid input tests passed.');

const near=(a,b,tolerance=1e-11)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const decodedNotes=p=>Object.values(p.patterns[0].notes).flat().sort((a,b)=>a.start-b.start||a.pitch-b.pitch);
for(const division of [960,1920]){
 const imported=decodeMidi(fixture([[1,[0x90,60,100]],[1,[0x80,60,0]]],division));assert.equal(imported.midi.division,division);assert.equal(imported.patterns[0].midiPpqn,division);
 const file=await encodeMidi(imported).arrayBuffer();assert.equal(new DataView(file).getUint16(12),division);const note=decodedNotes(decodeMidi(file))[0];near(note.start,1/division);near(note.duration,1/division);assert.ok(note.duration<.0011,'high-PPQ short notes never pass through a .001beat floor');
}
// No declared grid: derive enough resolution for an authored sub-480 note.
const precise={title:'Fine notes',bpm:120,selectedPattern:'fine',channels:[{id:'keys',type:'keys'}],patterns:[{id:'fine',bars:1,steps:{},notes:{keys:[{pitch:60,start:1/1920,duration:1/1920,velocity:.8}]}}],clips:[{patternId:'fine',start:0,length:4}]};
const preciseFile=await encodeMidi(precise).arrayBuffer();assert.equal(new DataView(preciseFile).getUint16(12),1920);near(decodedNotes(decodeMidi(preciseFile))[0].duration,1/1920);
// A native fractional tick can require more precision than its declared PPQ.
const fractional=structuredClone(precise);fractional.patterns[0].cloudRaw={ppq:96,bars:1,lengthTicks:384};assert.equal(new DataView(await encodeMidi(fractional).arrayBuffer()).getUint16(12),1920);
// Tempo-baked notes may require a multiple of the original MIDI division.
const tempoFine=decodeMidi(fixture([[0,[255,81,3,7,161,32]],[0,[0x90,60,100]],[1,[0x80,60,0]],[0,[255,81,3,9,39,192]],[0,[0x90,62,100]],[1,[0x80,62,0]]],960));
const tempoFineFile=await encodeMidi(tempoFine).arrayBuffer();assert.equal(new DataView(tempoFineFile).getUint16(12),4800);const tempoFineRound=decodedNotes(decodeMidi(tempoFineFile));near(tempoFineRound[0].duration,1/960);near(tempoFineRound[1].start,1/960);near(tempoFineRound[1].duration,1/800);
// Retain exact initial microseconds instead of rounding the imported BPM to 3 decimals.
const unusualUs=486003,unusual=decodeMidi(fixture([[0,[255,81,3,(unusualUs>>16)&255,(unusualUs>>8)&255,unusualUs&255]],[1,[0x90,60,100]],[1,[0x80,60,0]]],1920));assert.equal(unusual.bpm,60000000/unusualUs);const unusualRound=decodeMidi(await encodeMidi(unusual).arrayBuffer());assert.equal(unusualRound.bpm,unusual.bpm);near(decodedNotes(unusualRound)[0].duration,1/1920);
const tooFine=structuredClone(precise);tooFine.patterns[0].notes.keys[0].duration=1/65536;assert.throws(()=>encodeMidi(tooFine),/cannot be represented exactly/);
const tinyOnset=structuredClone(precise);tinyOnset.patterns[0].notes.keys[0]={pitch:60,start:1e-10,duration:.25,velocity:.8};assert.throws(()=>encodeMidi(tinyOnset),/cannot be represented exactly/,'a tiny genuine offset cannot silently round to zero under an absolute epsilon');
const incommensurate=structuredClone(precise);incommensurate.patterns[0].ppq=96000;incommensurate.patterns[0].notes.keys[0]={pitch:60,start:.25,duration:.25,velocity:.8};assert.equal(new DataView(await encodeMidi(incommensurate).arrayBuffer()).getUint16(12),480,'unused excessive source-grid precision does not discard representable notes');

function phaseProject({bpm=120,phase=1250,offset=0,baseMs=2000,loopMs=2000,windowMs=4750,repeats=4}={}){
 const native=[{id:'hit-0',type:'midi',sourceId:'keys',startTick:0,durationTick:24,note:60,velocity:.8},{id:'hit-1',type:'midi',sourceId:'keys',startTick:144,durationTick:24,note:61,velocity:.8},{id:'held',type:'midi',sourceId:'keys',startTick:192,durationTick:96,note:62,velocity:.8},{id:'hit-3',type:'midi',sourceId:'keys',startTick:336,durationTick:24,note:63,velocity:.8}];
 const pattern={id:'phase',bars:1,cloudRaw:{id:'phase',ppq:96,bars:1,lengthTicks:384,pattern:{sources:[{id:'keys',kind:'plugin',laneId:'instrument'}],events:native}}};
 return{title:'Canonical phase',bpm,selectedPattern:'phase',channels:[{id:'keys',type:'keys',volume:1}],patterns:[pattern],clips:[{id:'cut-right',patternId:'phase',laneId:'pattern-lane',track:0,start:3250*bpm/60000,length:windowMs*bpm/60000,cloudRaw:{startMs:3250,durationMs:baseMs,loopDurationMs:loopMs,offsetMs:offset,windowMs,repeatCount:repeats,loopPhaseMs:phase}}]};
}
const phased=phaseProject(),compiled=compileProjectEvents(phased);assert.deepEqual(compiled.events.map(note=>note.beat-6.5),[0,1,1.5,3,3.5,5,5.5,7,7.5,9]);assert.equal(compiled.events[0].pitch,62);assert.equal(compiled.events[0].duration,.5,'a held MIDI note crossing the cut retains only its surviving tail');assert.equal(compiled.events[0].sourceOffset,.5);const phaseRound=decodedNotes(decodeMidi(await encodeMidi(phased).arrayBuffer()));assert.equal(phaseRound.length,10);near(phaseRound[0].start,6.5);near(phaseRound[0].duration,.5);
for(const bpm of [90,180]){const p=phaseProject({bpm}),out=compileProjectEvents(p),factor=bpm/120;assert.equal(out.events.length,10);for(let i=0;i<out.events.length;i++){near(out.events[i].beat,compiled.events[i].beat*factor);near(out.events[i].duration,compiled.events[i].duration*factor);}}
for(const override of [{offset:100},{loopMs:1000}])assert.throws(()=>encodeMidi(phaseProject(override)),/phase contract/,'unsupported combinations cannot silently export without phase');
// Phase-zero tiled source trim uses the same per-tile offset/cycle as native previews.
const trimmed=phaseProject({phase:0,offset:500,windowMs:3000});trimmed.clips[0].start=0;const trimmedNotes=compileProjectEvents(trimmed).events;assert.deepEqual(trimmedNotes.map(note=>note.beat),[.5,1,2.5,3.5,4,5.5]);assert.equal(trimmedNotes[0].pitch,61);assert.ok(trimmedNotes.every(note=>note.beat+note.duration<=6));
// Canonical source timing scales to placement base length; bars metadata is not the cycle length.
const scaled=phaseProject({phase:0,baseMs:4000,loopMs:4000,windowMs:4000});scaled.clips[0].start=0;const scaledNotes=compileProjectEvents(scaled).events;assert.deepEqual(scaledNotes.map(note=>note.beat),[0,3,4,7]);assert.deepEqual(scaledNotes.map(note=>note.duration),[.5,.5,2,.5]);
const longPattern=structuredClone(precise);longPattern.patterns[0].bars=1;longPattern.patterns[0].cloudRaw={ppq:96,bars:1,lengthTicks:768};longPattern.patterns[0].notes.keys=[{pitch:67,start:6,duration:.25,velocity:.8}];longPattern.clips[0].length=16;assert.deepEqual(compileProjectEvents(longPattern).events.map(note=>note.beat),[6,14],'canonical lengthTicks overrides stale one-bar metadata');
// Off-grid canonical sample events and duplicate same-pitch polyphony are not viewer-deduplicated.
const poly=phaseProject({phase:0,windowMs:2000});poly.clips[0].start=0;poly.patterns[0].cloudRaw.pattern.events=[{id:'same-a',type:'midi',sourceId:'keys',startTick:12,durationTick:24,note:60,velocity:.8},{id:'same-b',type:'midi',sourceId:'keys',startTick:12,durationTick:24,note:60,velocity:.6},{id:'off-grid',type:'sample',sourceId:'keys',tick:6,velocity:.9}];assert.equal(compileProjectEvents(poly).events.length,3);assert.equal(decodedNotes(decodeMidi(await encodeMidi(poly).arrayBuffer())).length,3);
const budget=structuredClone(poly);budget.patterns[0].cloudRaw.pattern.events=[{id:'one',type:'midi',sourceId:'keys',startTick:0,durationTick:24,note:60,velocity:.8}];budget.clips[0].length=520*4;budget.clips[0].cloudRaw.windowMs=520*2000;assert.equal(compileProjectEvents(budget).events.length,520,'export is not capped at the thumbnail 128-repeat budget');
const dense=structuredClone(poly);dense.patterns[0].cloudRaw.pattern.events=Array.from({length:50001},(_,id)=>({id:`note-${id}`,type:'midi',sourceId:'keys',startTick:0,durationTick:1,note:60,velocity:.8}));assert.equal(compileProjectEvents(dense).events.length,50001,'export is not capped by the thumbnail event budget');assert.equal(decodedNotes(decodeMidi(await encodeMidi(dense).arrayBuffer())).length,50001);
// Audio takes never become invented MIDI notes.
const withAudio=structuredClone(poly);withAudio.audioClips=[{id:'audio',start:0,length:4,track:0}];assert.equal(compileProjectEvents(withAudio).events.length,3);
const muted=structuredClone(poly);muted.clips[0].cloudRaw.muted=true;assert.equal(compileProjectEvents(muted).events.length,0);muted.clips[0].cloudRaw.muted=false;muted.mutedTracks=[0];assert.equal(compileProjectEvents(muted).events.length,0);assert.equal(compileProjectEvents(muted,'pattern').events.length,3,'isolated pattern export ignores playlist row mute');
const sourceFlags=structuredClone(poly);sourceFlags.patterns[0].cloudRaw.pattern.sources.push({id:'other',kind:'plugin'});sourceFlags.patterns[0].cloudRaw.pattern.events.push({id:'other-hit',type:'midi',sourceId:'other',startTick:0,durationTick:24,note:72,velocity:.8});sourceFlags.channels.push({id:'other',type:'keys',patternSource:true,patternId:'phase',sourceId:'other',solo:true,mute:false});assert.deepEqual(compileProjectEvents(sourceFlags).events.map(note=>note.pitch),[72]);sourceFlags.channels[1].mute=true;assert.equal(compileProjectEvents(sourceFlags).events.length,0,'a muted solo source does not make non-solo sources audible');
const soloClip=structuredClone(poly);soloClip.clips.push({...structuredClone(soloClip.clips[0]),id:'second',start:8,cloudRaw:{...soloClip.clips[0].cloudRaw,soloed:true}});assert.ok(compileProjectEvents(soloClip).events.every(note=>note.beat>=8));
// Persisted lane flags and scoped source identities follow the actual audible binding.
const laneFlags=structuredClone(poly);laneFlags.channels.push({id:'instrument-row',laneId:'instrument',mute:true});assert.equal(compileProjectEvents(laneFlags).events.length,0);laneFlags.channels[1].mute=false;laneFlags.channels[1].solo=true;assert.equal(compileProjectEvents(laneFlags).events.length,3);laneFlags.channels[1].laneId='unrelated-lane';assert.equal(compileProjectEvents(laneFlags).events.length,0);
const placementLane=structuredClone(poly);placementLane.channels.push({id:'pattern-row',laneId:'pattern-lane',mute:true});assert.equal(compileProjectEvents(placementLane).events.length,0);placementLane.channels[1].mute=false;placementLane.channels[1].solo=true;assert.equal(compileProjectEvents(placementLane).events.length,3);
const scoped=structuredClone(poly);scoped.channels=[{id:'keys',type:'keys',patternSource:true,patternId:'other',sourceId:'keys',mute:true},{id:'phase::keys',type:'keys',patternSource:true,patternId:'phase',sourceId:'keys',mute:false}];scoped.patterns[0].cloudSources={'phase::keys':'keys'};assert.deepEqual([...new Set(compileProjectEvents(scoped).events.map(event=>event.channelId))],['phase::keys']);assert.equal(decodedNotes(decodeMidi(await encodeMidi(scoped).arrayBuffer())).length,3,'a colliding source ID in another pattern cannot mute the scoped source');
const mapped=structuredClone(scoped),first=mapped.patterns[0].cloudRaw.pattern.events[0];mapped.patterns[0].cloudMappedEventIds=[first.id];mapped.patterns[0].notes={'phase::keys':[{start:.5,duration:.125,pitch:75,velocity:.8,cloudRaw:structuredClone(first)}]};const mappedEvents=compileProjectEvents(mapped).events;assert.equal(mappedEvents.length,3);assert.equal(mappedEvents.find(note=>note.pitch===75).beat,.5,'edited mapped notes replace their old raw events without swallowing unmapped polyphony');
console.log('MIDI export fidelity: source/derived960–1920+PPQ, tempo-baked precision, exact timing failures, canonical phase/windows/repeats, uncapped polyphony and effective mute/solo passed.');

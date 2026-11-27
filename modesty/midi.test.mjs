import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const midi = await readFile(new URL('./midi.js',import.meta.url),'utf8');
const {encodeMidi,decodeMidi}=await import(`data:text/javascript;base64,${Buffer.from(midi).toString('base64')}`);
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
assert.throws(()=>decodeMidi(new ArrayBuffer(2)),/truncated/);
assert.throws(()=>decodeMidi(fixture([],0x8001)),/SMPTE/);
assert.throws(()=>decodeMidi(fixture([[0,[60,100]]])),/running status/);
console.log('MIDI: format-1 round-trip, 480 PPQN, polyphony, drum mapping, running status, program changes, tempo changes, sustain, and invalid input tests passed.');

/** Empty editor labels stay outside the canonical project and its history. */
const EMPTY_PATTERN=Object.freeze({id:'empty',name:'No pattern selected',bars:1,steps:Object.freeze({}),notes:Object.freeze({})});
const EMPTY_CHANNEL=Object.freeze({id:'empty',name:'Add a cloud channel',type:'cloud',volume:1,pan:0,mute:false,solo:false,effects:Object.freeze({})});

export function presentationPattern(project){return project.patterns.find(pattern=>pattern.id===project.selectedPattern)||project.patterns[0]||EMPTY_PATTERN;}
export function presentationChannel(project,selectedChannel){return project.channels.find(channel=>channel.id===selectedChannel)||project.channels[0]||EMPTY_CHANNEL;}
export function presentationChannelId(project,selectedChannel){
 const sourceIds=Object.keys(presentationPattern(project).cloudSources||{}).filter(id=>project.channels.some(channel=>channel.id===id));
 return sourceIds.includes(selectedChannel)?selectedChannel:sourceIds[0]||presentationChannel(project,selectedChannel).id;
}

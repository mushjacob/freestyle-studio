/** Small UI copy helpers. Counts always agree with their noun. */
export function countLabel(count,singular,plural=`${singular}s`){const n=Number(count)||0;return `${n} ${n===1?singular:plural}`;}
export function playlistCopiesSavedMessage(count){return `${countLabel(count,'Playlist copy','Playlist copies')} saved.`;}

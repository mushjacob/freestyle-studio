/** FL-style LCD position readout: every digit lives in its own fixed-width cell, so
 *  digits and separators never move as values change (only the digit text does). */
export function paintTimeReadout(host,text){
 if(!host)return;
 const fields=String(text).split(':'),signature=host._tvFields;
 const bar=Math.max(host._tvBar||1,fields[0].length||1);
 if(!signature||signature.length!==fields.length||host._tvBar!==bar){
  host._tvBar=bar;
  const doc=host.ownerDocument,widths=fields.map((_,index)=>index===0?bar:2);
  host.textContent='';host._tvFields=widths;host._tvCells=[];
  fields.forEach((_,index)=>{
   if(index){const sep=doc.createElement('span');sep.className='tv-s';sep.textContent=':';host.append(sep);}
   const cells=[];for(let n=0;n<widths[index];n++){const cell=doc.createElement('span');cell.className='tv-d';host.append(cell);cells.push(cell);}
   host._tvCells.push(cells);
  });
 }
 fields.forEach((field,index)=>{
  const cells=host._tvCells[index],pad=field.padStart(cells.length,' ');
  cells.forEach((cell,n)=>{const ch=pad[n]===' '?'':pad[n];if(cell.textContent!==ch)cell.textContent=ch;});
 });
}

// Pure helpers for the FL "History" list (no DOM, no I/O).
export function buildHistoryRows(labels,index){
  const list=Array.isArray(labels)?labels:[];
  const at=Number.isInteger(index)?Math.max(0,Math.min(list.length,index)):list.length;
  const rows=list.map((label,i)=>{const position=i+1,done=position<=at,name=typeof label==='string'&&label?label:'edit';return{position,label:name,text:done?name:`Undone: ${name}`,done,current:position===at};});
  return rows.reverse();
}
export function historyTitle(count){const n=Math.max(0,Number(count)||0);return `Undo history (${n} ${n===1?'step':'steps'})`;}
export function stepsToTarget(index,target,total=Infinity){
  if(!Number.isInteger(index)||!Number.isInteger(target)||target<0||target>total||index<0)return{direction:null,count:0};
  if(target===index)return{direction:null,count:0};
  return target<index?{direction:'undo',count:index-target}:{direction:'redo',count:target-index};
}

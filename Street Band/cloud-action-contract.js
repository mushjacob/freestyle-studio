/** Small typed action discovery for destructive identity-based controls. No mutations. */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const clone=value=>structuredClone(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const annotation=key=>key.startsWith('x-')||['title','description','default','examples','$comment','deprecated','readOnly','writeOnly'].includes(key);
function walk(value,visit){
 const pending=[{value,depth:0}],seen=new WeakSet();let count=0;
 while(pending.length){const {value:item,depth}=pending.pop();if(!item||typeof item!=='object')continue;if(seen.has(item)||depth>16||++count>4096)throw new Error('The action capability exceeds bounded discovery limits.');seen.add(item);visit(item);for(const child of Object.values(item))if(child&&typeof child==='object')pending.push({value:child,depth:depth+1});}
}
function keywords(schema,allowed,label){for(const key of Object.keys(schema))if(!annotation(key)&&!allowed.includes(key))throw new Error(`${label} uses unsupported schema constraint ${key}; no deletion was sent.`);}
function valueFor(value,schema,label){
 if(!record(schema)||schema.readOnly===true)throw new Error(`${label} has no writable typed schema.`);
 keywords(schema,['type','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern'],label);
 if(schema.type==='string'){if(typeof value!=='string')throw new Error(`${label} needs a string.`);}
 else if(schema.type==='boolean'){if(typeof value!=='boolean')throw new Error(`${label} needs a boolean.`);}
 else if(['number','integer'].includes(schema.type)){if(typeof value!=='number'||!Number.isFinite(value)||schema.type==='integer'&&!Number.isInteger(value))throw new Error(`${label} needs a finite ${schema.type}.`);}
 else if(schema.type==='null'){if(value!==null)throw new Error(`${label} needs null.`);}
 else throw new Error(`${label} has an unsupported or missing scalar type.`);
 if(own(schema,'const')&&!equal(value,schema.const)||own(schema,'enum')&&(!Array.isArray(schema.enum)||!schema.enum.some(item=>equal(item,value))))throw new Error(`${label} does not permit this value.`);
 if(typeof value==='string'){
  for(const key of ['minLength','maxLength'])if(own(schema,key)&&(!Number.isInteger(schema[key])||schema[key]<0))throw new Error(`${label} has an invalid ${key}.`);
  const length=Array.from(value).length;if(own(schema,'minLength')&&length<schema.minLength||own(schema,'maxLength')&&length>schema.maxLength)throw new Error(`${label} is outside its discovered length.`);
  if(own(schema,'pattern')){if(typeof schema.pattern!=='string')throw new Error(`${label} has no usable pattern.`);let pattern;try{pattern=new RegExp(schema.pattern,'u');}catch{throw new Error(`${label} has an unsupported pattern.`);}if(!pattern.test(value))throw new Error(`${label} does not match its discovered pattern.`);}
 }
 if(typeof value==='number'){
  for(const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'])if(own(schema,key)&&(!Number.isFinite(schema[key])||key==='multipleOf'&&schema[key]<=0))throw new Error(`${label} has an invalid ${key}.`);
  if(own(schema,'minimum')&&value<schema.minimum||own(schema,'maximum')&&value>schema.maximum||own(schema,'exclusiveMinimum')&&value<=schema.exclusiveMinimum||own(schema,'exclusiveMaximum')&&value>=schema.exclusiveMaximum)throw new Error(`${label} is outside its discovered range.`);
  if(own(schema,'multipleOf')){const ratio=value/schema.multipleOf;if(Math.abs(ratio-Math.round(ratio))>Math.max(1,Math.abs(ratio))*1e-12)throw new Error(`${label} is not a discovered multiple.`);}
 }
 return clone(value);
}
export function typedActionCapability(result,action){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable action capability.');}}
 data=data??result;const payload=data?.response??data;
 if(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error)throw new Error(String(payload?.error||data?.error||'Freestyle rejected action discovery.'));
 const matches=[];walk(payload,item=>{
  for(const [key,value]of Object.entries(item))if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&value)throw new Error('Freestyle returned truncated action discovery.');
  if(item.name===action&&record(item.argumentSchema)&&item.argumentSchema.type==='object')matches.push(item);
 });
 if(matches.length!==1)throw new Error(`Freestyle did not return one uniquely named typed ${action} capability.`);
 const capability=matches[0],schema=capability.argumentSchema;
 if(!record(schema.properties)||schema.readOnly===true||capability.mutates===false)throw new Error(`The ${action} capability is not a typed writable action.`);
 keywords(schema,['type','properties','required','additionalProperties','minProperties','maxProperties','$schema','$id'],`${action} argument schema`);
 const required=schema.required??[];if(!Array.isArray(required)||required.some(key=>typeof key!=='string')||new Set(required).size!==required.length)throw new Error(`The ${action} required arguments are invalid.`);
 return{action,schema:clone(schema)};
}
export function typedIdentityActionArguments(capability,{identityField,identity,projectId}={}){
 const {action,schema}=capability;
 if(typeof identity!=='string'||!identity||identity.length>64||!record(schema.properties[identityField])||schema.properties[identityField].type!=='string')throw new Error(`${action} requires a discovered durable string ${identityField}; no name or runtime-index fallback is supported.`);
 const args={[identityField]:valueFor(identity,schema.properties[identityField],`${action}.${identityField}`)};
 if(own(schema.properties,'project_id'))args.project_id=valueFor(projectId,schema.properties.project_id,`${action}.project_id`);
 for(const key of schema.required??[]){if(own(args,key))continue;const field=schema.properties[key];if(!record(field)||!own(field,'default'))throw new Error(`Required ${action} argument ${key} has no explicit typed default; no value will be guessed.`);args[key]=valueFor(field.default,field,`${action}.${key}`);}
 for(const key of ['minProperties','maxProperties'])if(own(schema,key)&&(!Number.isInteger(schema[key])||schema[key]<0))throw new Error(`${action} has an invalid ${key}.`);
 if(own(schema,'minProperties')&&Object.keys(args).length<schema.minProperties||own(schema,'maxProperties')&&Object.keys(args).length>schema.maxProperties)throw new Error(`${action} does not permit these discovered arguments.`);
 return args;
}

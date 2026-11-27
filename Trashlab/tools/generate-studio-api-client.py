#!/usr/bin/env python3
"""Generate the dependency-free Studio API client and proxy allowlist from OpenAPI.

Regenerate from the checked-in snapshot:
  python3 tools/generate-studio-api-client.py
Refresh explicitly from production:
  python3 tools/generate-studio-api-client.py --url https://freestyle.audio/api/v1/openapi.json
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SOURCE_URL = "https://freestyle.audio/api/v1/openapi.json"
METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}


def canonical(value):
    return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def resolve_parameter(value, spec):
    if "$ref" not in value:
        return value
    pointer = value["$ref"]
    if not pointer.startswith("#/"):
        raise ValueError("External parameter references are not supported: " + pointer)
    result = spec
    for name in pointer[2:].split("/"):
        result = result[name.replace("~1", "/").replace("~0", "~")]
    return result


def generate_metadata(spec):
    if not str(spec.get("openapi", "")).startswith("3.1"):
        raise ValueError("Studio client generation expects OpenAPI 3.1.")
    servers = spec.get("servers", [])
    if not servers or servers[0].get("url") != "/api/v1":
        raise ValueError("Expected the Studio API /api/v1 server prefix.")
    operations = {}
    for path, item in sorted(spec["paths"].items()):
        if not path.startswith("/") or "?" in path or "#" in path or ".." in path.split("/"):
            raise ValueError("Unsafe path template: " + path)
        for method, operation in sorted(item.items()):
            if method not in METHODS:
                continue
            name = operation.get("operationId")
            if not name or name in operations:
                raise ValueError("Missing or duplicate operationId: " + str(name))
            parameters = {}
            for parameter in item.get("parameters", []) + operation.get("parameters", []):
                parameter = resolve_parameter(parameter, spec)
                parameters[(parameter["in"], parameter["name"])] = parameter
            operations[name] = {
                "operationId": name,
                "method": method.upper(),
                "path": path,
                "parameters": list(parameters.values()),
                "requestBody": operation.get("requestBody"),
                "responses": operation.get("responses", {}),
                "scope": operation.get("x-freestyle-scope"),
                "role": operation.get("x-freestyle-role"),
                "rate": operation.get("x-freestyle-rate"),
                "confirmation": operation.get("x-freestyle-confirmation"),
                "mcpEquivalent": operation.get("x-freestyle-mcp-equivalent"),
                "summary": operation.get("summary", name),
                "mutates": method not in {"get", "head", "options"},
            }
    return {
        "openapi": spec["openapi"],
        "source": SOURCE_URL,
        "specSha256": hashlib.sha256(canonical(spec).encode()).hexdigest(),
        "basePath": "/api/v1",
        "operations": dict(sorted(operations.items())),
        "components": spec.get("components", {}),
    }


RUNTIME = r'''
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;}
function invalid(message){return Object.assign(new TypeError(message),{code:'studio_client_invalid_request',stage:'client_validation',dispatched:false});}
function keys(value,allowed,label){if(!record(value))throw invalid(label+' must be a plain object.');for(const key of Object.keys(value))if(!allowed.has(key))throw invalid('Unknown '+label+' field: '+key);}
function parameterValue(value,schema,label){
 if(value==null)throw invalid(label+' must not be null.');
 const type=schema?.type;
 if(type==='string'&&typeof value!=='string'||type==='boolean'&&typeof value!=='boolean'||type==='integer'&&(!Number.isInteger(value))||type==='number'&&(typeof value!=='number'||!Number.isFinite(value)))throw invalid(label+' has the wrong type.');
 if(typeof value==='number'&&!Number.isFinite(value))throw invalid(label+' must be finite.');
 if(typeof value==='string'){if(schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&value.length>schema.maxLength)throw invalid(label+' has an invalid length.');if(schema.pattern&&!new RegExp(schema.pattern).test(value))throw invalid(label+' does not match its parameter format.');}
 if(typeof value==='number'&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))throw invalid(label+' is outside the supported range.');
 if(schema.enum&&!schema.enum.includes(value))throw invalid(label+' has an unsupported value.');
 if(!['string','number','boolean'].includes(typeof value))throw invalid(label+' must be a scalar JSON parameter.');
 return value;
}
function jsonClone(value){
 const seen=new Set();const visit=item=>{if(typeof item==='number'&&!Number.isFinite(item))throw invalid('JSON bodies cannot contain non-finite numbers.');if(item==null||['string','number','boolean'].includes(typeof item))return;if(typeof item==='undefined')return;if(typeof item!=='object'||!Array.isArray(item)&&!record(item))throw invalid('The body must contain only JSON values.');if(seen.has(item))throw invalid('JSON bodies cannot contain cycles.');seen.add(item);for(const child of Object.values(item))visit(child);seen.delete(item);};
 visit(value);try{return JSON.parse(JSON.stringify(value));}catch{throw invalid('The request body must be serializable JSON.');}
}
function header(value,label,{minimum=1,maximum=1024}={}){if(typeof value!=='string'||value.length<minimum||value.length>maximum||/[\u0000-\u001f\u007f]/.test(value))throw invalid(label+' is not a valid header value.');return value;}
function operationFor(operationId){if(typeof operationId!=='string'||!own(STUDIO_API_OPERATIONS,operationId))throw invalid('Unknown Studio API operation: '+String(operationId));return STUDIO_API_OPERATIONS[operationId];}
function validateRequest(request){
 keys(request,new Set(['operationId','path','query','body','idempotencyKey','ifMatch']),'Studio request');
 const operation=operationFor(request.operationId),pathParameters=operation.parameters.filter(parameter=>parameter.in==='path'),queryParameters=operation.parameters.filter(parameter=>parameter.in==='query'),path=request.path??{},query=request.query??{};
 keys(path,new Set(pathParameters.map(parameter=>parameter.name)),'path');keys(query,new Set(queryParameters.map(parameter=>parameter.name)),'query');
 for(const [parameters,values,label]of [[pathParameters,path,'path'],[queryParameters,query,'query']])for(const parameter of parameters){const present=own(values,parameter.name)&&values[parameter.name]!==undefined;if(parameter.required&&!present)throw invalid('Missing required '+label+' parameter: '+parameter.name);if(present)parameterValue(values[parameter.name],parameter.schema??{},label+'.'+parameter.name);}
 const bodyPresent=own(request,'body')&&request.body!==undefined;
 if(operation.requestBody?.required&&!bodyPresent)throw invalid('Missing required JSON body for '+request.operationId);if(bodyPresent&&!operation.requestBody)throw invalid(request.operationId+' does not accept a JSON body.');
 if(bodyPresent){const content=operation.requestBody.content??{};if(!own(content,'application/json'))throw invalid(request.operationId+' does not accept JSON transport.');jsonClone(request.body);}
 if(operation.mutates&&!own(request,'idempotencyKey'))throw invalid('Prepared writes require their retained Idempotency-Key.');
 if(own(request,'idempotencyKey'))header(request.idempotencyKey,'Idempotency-Key',{minimum:8,maximum:128});if(own(request,'ifMatch'))header(request.ifMatch,'If-Match');
 for(const parameter of operation.parameters.filter(parameter=>parameter.in==='header'&&parameter.required)){if(parameter.name.toLowerCase()==='if-match'&&!own(request,'ifMatch'))throw invalid('Missing required If-Match precondition.');if(parameter.name.toLowerCase()==='idempotency-key'&&!own(request,'idempotencyKey'))throw invalid('Missing required Idempotency-Key.');}
 return operation;
}
const encodePath=value=>encodeURIComponent(String(value)).replace(/[!'()*]/g,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase());
/** Pure request description for diagnostics/tests. send() transmits only the
 * operationId and structured arguments to the same-origin credential proxy. */
export function describeStudioRequest(request){
 const operation=validateRequest(request);let path=operation.path;
 for(const parameter of operation.parameters.filter(parameter=>parameter.in==='path'))path=path.replaceAll('{'+parameter.name+'}',encodePath(request.path[parameter.name]));
 if(/\{[^}]*\}/.test(path))throw invalid('The generated path still contains an unresolved parameter.');
 const query=new URLSearchParams();for(const parameter of operation.parameters.filter(parameter=>parameter.in==='query'))if(own(request.query,parameter.name)&&request.query[parameter.name]!==undefined)query.append(parameter.name,String(request.query[parameter.name]));
 const headers={};if(own(request,'idempotencyKey'))headers['Idempotency-Key']=request.idempotencyKey;if(own(request,'ifMatch'))headers['If-Match']=request.ifMatch;
 return deepFreeze({operationId:request.operationId,method:operation.method,url:STUDIO_API_METADATA.basePath+path+(query.size?'?'+query.toString():''),headers,...(own(request,'body')?{body:jsonClone(request.body)}:{})});
}
export class StudioApiError extends Error{
 constructor(message,{status=0,data=null,headers={},request=null,cause,uncertain,stage}={}){super(message,...(cause===undefined?[]:[{cause}]));this.name='StudioApiError';const detail=record(data?.error)?data.error:{};Object.assign(this,{status,data,etag:headers.etag??null,retryAfter:headers.retryAfter??null,code:detail.code??(status?'studio_http_error':'studio_network_error'),stage:detail.stage??stage??(status?'http':'network'),...(detail.engineStatus===undefined?{}:{engineStatus:detail.engineStatus}),details:detail.details??null,requestId:detail.requestId??headers.requestId??null,idempotencyKey:request?.idempotencyKey??null,request,dispatched:true,operationUncertain:uncertain??(!!request&&operationFor(request.operationId).mutates&&(status===0||status>=500||status===408)),preconditionFailed:status===412});}
}
function requestId(){if(typeof globalThis.crypto?.randomUUID!=='function')throw invalid('A UUID generator is required to prepare an idempotent write.');return globalThis.crypto.randomUUID();}
/** Generated Studio API v1 client. Credentials stay in the Freestyle host bridge. No write
 * retry, credential header, arbitrary URL or MCP fallback is implemented here. */
export class StudioApiClient{
 constructor(options={}){keys(options,new Set(['fetch','endpoint','idFactory']),'client options');const{fetch:fetcher=hostFetch,endpoint='/api/studio',idFactory=requestId}=options;if(endpoint!=='/api/studio')throw invalid('Studio requests must use the same-origin /api/studio proxy.');if(typeof fetcher!=='function'||typeof idFactory!=='function')throw invalid('Studio client requires fetch and idFactory functions.');this.fetcher=(...args)=>Reflect.apply(fetcher,globalThis,args);Object.defineProperty(this,'endpoint',{enumerable:true,value:endpoint});this.idFactory=idFactory;for(const operationId of Object.keys(STUDIO_API_OPERATIONS)){if(operationId in this)throw invalid('Generated operation conflicts with the client: '+operationId);Object.defineProperty(this,operationId,{enumerable:false,value:(parameters,requestOptions)=>this.call(operationId,parameters,requestOptions)});}}
 prepare(operationId,parameters={},options={}){
  const operation=operationFor(operationId);keys(parameters,new Set(['path','query','body']),'operation parameters');keys(options,new Set(['idempotencyKey','ifMatch','signal']),'request options');
  const request={operationId,path:parameters.path??{},query:parameters.query??{},...(own(parameters,'body')&&parameters.body!==undefined?{body:parameters.body}:{}),...(operation.mutates?{idempotencyKey:options.idempotencyKey??this.idFactory()}:options.idempotencyKey!==undefined?{idempotencyKey:options.idempotencyKey}:{}),...(options.ifMatch===undefined?{}:{ifMatch:options.ifMatch})};validateRequest(request);return deepFreeze(jsonClone(request));
 }
 async send(request,options={}){
  keys(options,new Set(['signal']),'send options');validateRequest(request);const retained=deepFreeze(jsonClone(request));let response;
  try{response=await this.fetcher(this.endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(retained),...(options.signal===undefined?{}:{signal:options.signal})});}catch(error){throw new StudioApiError(error?.message||'The Studio request did not complete.',{request:retained,cause:error});}
  const headers={etag:response.headers?.get?.('etag')??null,retryAfter:response.headers?.get?.('retry-after')??null,requestId:response.headers?.get?.('x-request-id')??null};let data=null;
  if(response.status!==204&&response.status!==304){try{data=await response.json();}catch(error){throw new StudioApiError('Studio returned an unreadable JSON response.',{status:response.status,headers,request:retained,cause:error,uncertain:operationFor(retained.operationId).mutates,stage:'response_parse'});}}
  if(!response.ok&&response.status!==304){const detail=record(data?.error)?data.error:{};throw new StudioApiError(detail.message||'Studio returned HTTP '+response.status+'.',{status:response.status,data,headers,request:retained});}
  return deepFreeze({data,status:response.status,etag:headers.etag,idempotencyKey:retained.idempotencyKey??null,request:retained});
 }
 call(operationId,parameters={},options={}){let prepared;try{prepared=this.prepare(operationId,parameters,options);}catch(error){return Promise.reject(error);}return this.send(prepared,{...(options.signal===undefined?{}:{signal:options.signal})});}
}
'''


def outputs(spec):
    metadata = generate_metadata(spec)
    javascript = (
        "// Generated by tools/generate-studio-api-client.py. Do not edit.\n"
        "// Source: " + SOURCE_URL + "\n"
        "// Spec SHA-256: " + metadata["specSha256"] + "\n"
        "// Freestyle embed: '/api/studio' is served in-page by freestyle-host-transport.js (no local bridge).\n"
        "import {hostFetch} from './freestyle-host-transport.js';\n"
        "export const STUDIO_API_METADATA=deepFreeze(" + json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + ");\n"
        "export const STUDIO_API_OPERATIONS=STUDIO_API_METADATA.operations;\n"
        + RUNTIME.lstrip()
    )
    return {
        "docs/studio-api-openapi.json": canonical(spec),
        "docs/studio-api-operations.json": canonical(metadata),
        "studio-api-client.js": javascript,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--spec", type=Path, default=None)
    source.add_argument("--url", default=None)
    parser.add_argument("--output-root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.url:
        if args.url != SOURCE_URL:
            parser.error("Only the official Studio API OpenAPI URL is supported.")
        with urllib.request.urlopen(args.url, timeout=60) as response:
            spec = json.load(response)
    else:
        spec = json.loads((args.spec or ROOT / "docs/studio-api-openapi.json").read_text())
    changed = []
    for relative, content in outputs(spec).items():
        target = args.output_root / relative
        if args.check:
            if not target.is_file() or target.read_text() != content:
                changed.append(relative)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
    if changed:
        print("Generated Studio API files differ: " + ", ".join(changed), file=sys.stderr)
        return 1
    metadata = generate_metadata(spec)
    print(("Checked" if args.check else "Generated") + " Studio API client: " + str(len(metadata["operations"])) + " operations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

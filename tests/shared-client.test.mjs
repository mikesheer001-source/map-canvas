import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {FEATURE_DEFAULTS} from "../enhancements.js";

const source=readFileSync(new URL("../app.js",import.meta.url),"utf8")
  .replace(/^import .*;\s*/,"").replace(/main\(\)\.catch\([^;]*;\s*$/,"");
let revision=1;
const rows=new Map();
const tombstones=new Map();
let failWrite=false;
let photoUploads=0;
const seed={id:"hostel-1",kind:"place",title:"First",lat:21,lng:105,version:1};
rows.set(seed.id,seed);
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
async function sharedFetch(url,options={}){
  if(String(url).startsWith("data:"))return new Response(new Blob(["photo"],{type:"image/jpeg"}));
  const path=new URL(url).pathname;
  if(path.endsWith("/pins")&&(!options.method||options.method==="GET"))
    return json({entries:[...rows.values()],revision});
  if(path.endsWith("/photo")){photoUploads++;return json({photo:"https://images.example/photo.jpg"});}
  if(failWrite){failWrite=false;throw new Error("connection lost");}
  const body=JSON.parse(options.body);
  if(path.endsWith("/import")){
    if(body.expectedRevision!==revision)return json({error:"changed"},409);
    if(body.mode==="replace")rows.clear();
    for(const entry of body.entries)rows.set(entry.id,{...entry,version:(rows.get(entry.id)?.version||0)+1});
    revision++;
    return json({entries:[...rows.values()],revision,added:body.entries.length,updated:0});
  }
  const id=decodeURIComponent(path.split("/").pop());
  const current=rows.get(id);
  const version=current?.version??tombstones.get(id)??null;
  if(body.expectedVersion!==version)return json({error:"changed"},409);
  if(options.method==="DELETE"){
    rows.delete(id);tombstones.set(id,version+1);revision++;
    return json({version:version+1,revision});
  }
  const entry={...body.entry,version:(version??0)+1};
  rows.set(id,entry);tombstones.delete(id);revision++;
  return json({entry,revision});
}
function client(){
  const storage=new Map();
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const nodes=new Map();
  const document={getElementById(id){
    if(!nodes.has(id))nodes.set(id,{textContent:"",disabled:false,classList:{add(){},remove(){},contains(){return true;}}});
    return nodes.get(id);
  }};
  const window={};
  const location={hostname:"test.invalid",search:""};
  const make=new Function("document","window","location","FEATURE_DEFAULTS","localStorage","fetch",source+`
    render=()=>{}; notify=()=>{};
    return {state,loadHostels,submitChange,recordChange,replayHistory,importPins};
  `);
  return make(document,window,location,FEATURE_DEFAULTS,localStorage,sharedFetch);
}
const a=client(),b=client();
await a.loadHostels();await b.loadHostels();
const newPin={id:"new-pin",kind:"place",title:"New",lat:21,lng:105,photo:"data:image/jpeg;base64,ZmFrZXBob3RvZmFrZXBob3Rv"};
const created=await a.submitChange("save",newPin);
a.recordChange({before:null,after:created.entry});
assert.equal(photoUploads,1);
assert.equal(created.entry.photo,"https://images.example/photo.jpg");
await b.loadHostels();
assert.equal(b.state.entries.find(pin=>pin.id===newPin.id).title,"New");
const edited=await b.submitChange("save",{...created.entry,title:"Edited"});
b.recordChange({before:created.entry,after:edited.entry});
await a.loadHostels();
assert.equal(a.state.entries.find(pin=>pin.id===newPin.id).title,"Edited");
const afterEdit=await a.submitChange("save",{...edited.entry,title:"Edited twice"});
a.recordChange({before:edited.entry,after:afterEdit.entry});
const last=await a.submitChange("save",{...afterEdit.entry,title:"Edited three times"});
a.recordChange({before:afterEdit.entry,after:last.entry});
await a.replayHistory("undo");
assert.equal(rows.get(newPin.id).title,"Edited twice");
await a.replayHistory("undo");
assert.equal(rows.get(newPin.id).title,"Edited");
await a.replayHistory("redo");
assert.equal(rows.get(newPin.id).title,"Edited twice");
const current=a.state.entries.find(pin=>pin.id===newPin.id);
const deleted=await a.submitChange("delete",current);
a.recordChange({before:current,after:null,version:deleted.version});
await b.loadHostels();
assert.equal(b.state.entries.some(pin=>pin.id===newPin.id),false);
await a.replayHistory("undo");
await b.loadHostels();
assert.equal(b.state.entries.find(pin=>pin.id===newPin.id).title,"Edited twice");
failWrite=true;
const previous=a.state.entries.find(pin=>pin.id===newPin.id);
await assert.rejects(a.submitChange("save",{...previous,title:"Retry"}),/retry/i);
assert.equal(a.state.entries.find(pin=>pin.id===newPin.id).title,"Edited twice");
await a.submitChange("save",{...previous,title:"Retry"});
await b.loadHostels();
assert.equal(b.state.entries.find(pin=>pin.id===newPin.id).title,"Retry");
// Another client's update must not be erased by a stale replace.
const staleRevision=a.state.revision;
await b.submitChange("save",{...b.state.entries[0],title:"Concurrent edit"});
assert.equal(a.state.revision,staleRevision);
await a.importPins([{id:"newer",title:"Imported",kind:"place",lat:21,lng:105}],"merge");
assert.equal(rows.has(seed.id),true);
console.log("PASS: two shared clients, uploaded photos, versioned edits, undo/redo, retry and imports");

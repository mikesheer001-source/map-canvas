import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const code=readFileSync(new URL("../sheets-bridge.gs",import.meta.url),"utf8");
assert.match(code,/HISTORY_TAB="Map Canvas History"/);
assert.match(code,/audit_\(store\.book,body\.action/);
assert.match(code,/historyTab_\(store\.book\)/);
assert.match(code,/controlBurst_\(hashed,body\.action==="save"&&!existing\)/);
assert.match(code,/mapCanvasRestoreBefore_/);
assert.ok(!code.slice(code.indexOf("function doGet"),code.indexOf("function sha256_")).includes("HISTORY_TAB"),
 "History must not appear in the public read endpoint");
const values=new Map();
const props={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v)};
const context=vm.createContext({
 PropertiesService:{getScriptProperties:()=>props},Date,Number,Math,Error,String,JSON,
});
vm.runInContext(code,context);
const rate=vm.runInContext("controlBurst_",context);
rate("key1",true);
assert.throws(()=>rate("key1",true),/Wait four seconds/);
for(let i=0;i<11;i++)rate("unique"+i,true);
assert.throws(()=>rate("overflow",true),/Rate limit reached/);
const historyRows=[];
const sheet={
 getLastRow:()=>historyRows.length,
 getRange:()=>({setValues:(rows)=>{historyRows.push(...rows)}}),
 setFrozenRows:()=>{},
 appendRow:r=>historyRows.push(r)
};
const book={getSheetByName:()=>historyRows.length?sheet:null,insertSheet:()=>sheet};
const getHistory=vm.runInContext("historyTab_",context);
assert.equal(getHistory(book),sheet);
const audit=vm.runInContext("audit_",context);
audit(book,"save","id1",["old"],["new"],"rev","abcdef123456789");
assert.equal(historyRows.length,2);
assert.equal(historyRows[1][3],'["old"]');
assert.equal(historyRows[1][4],'["new"]');
assert.equal(historyRows[1][6],"abcdef123456");
console.log("PASS: private audit snapshots, owner recovery hooks, global rate limits and per-key cooldown");

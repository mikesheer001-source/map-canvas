import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const code=readFileSync(new URL("../sheets-bridge.gs",import.meta.url),"utf8");
assert.match(code,/HISTORY_TAB="Map Canvas History"/);
assert.match(code,/audit_\(store\.book,body\.action/);
assert.match(code,/historyTab_\(store\.book\)/);
assert.doesNotMatch(code,/controlBurst_/);
assert.match(code,/mapCanvasRestoreBefore_/);
assert.ok(!code.slice(code.indexOf("function doGet"),code.indexOf("function sha256_")).includes("HISTORY_TAB"),
 "History must not appear in the public read endpoint");
const context=vm.createContext({Date,Number,Math,Error,String,JSON});
vm.runInContext(code,context);
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
console.log("PASS: private audit snapshots, owner recovery hooks, no write throttling");

/**
 * Map Canvas public Google Sheets bridge.
 * Sheet: https://docs.google.com/spreadsheets/d/19--eDj8Xj_ux0QanDyGGVD9y7UeAXMqwN-aO7DikXnA
 *
 * Deploy as Web App: Execute as Me; access Anyone.
 * Everything read or written to the Map Canvas tab is public by design.
 */
const WORKBOOK_ID = "19--eDj8Xj_ux0QanDyGGVD9y7UeAXMqwN-aO7DikXnA";
const HOSTEL_TAB = "Hanoi Nov 12–14";
const PINS_TAB = "Map Canvas";
const HEADERS = ["ID","Title","Type","Category","Latitude","Longitude","Notes","Photo URL","Price","Rating","Version","Edit key hash"];
const MAX_ROWS = 500;
const EXTRA_HEADERS = ["Icon","Color","Canvas metadata"];
const HISTORY_TAB="Map Canvas History";
const HISTORY_HEADERS=["Timestamp","Action","ID","Before JSON","After JSON","Revision","Key fingerprint"];
const MAX_HISTORY=10000;
function mapTab_() {
  const book = SpreadsheetApp.openById(WORKBOOK_ID);
  const sheet = book.getSheetByName(PINS_TAB);
  if (!sheet) throw new Error("Map Canvas tab not found.");
  if (sheet.getMaxColumns() < 15) sheet.insertColumnsAfter(sheet.getMaxColumns(),15-sheet.getMaxColumns());
  if (sheet.getRange(1,1,1,11).getDisplayValues()[0].join("|") !== HEADERS.slice(0,11).join("|"))
    throw new Error("Map Canvas tab headers have changed.");
  sheet.getRange(1,12).setValue(HEADERS[11]);
  if(sheet.getRange(1,13,1,3).getDisplayValues()[0].join("|")!==EXTRA_HEADERS.join("|"))
    sheet.getRange(1,13,1,3).setValues([EXTRA_HEADERS]);
  return {sheet,book};
}
function readMeta_(raw) {
  try {
    const m=JSON.parse(String(raw||"{}"));
    if(!m||typeof m!=="object"||Array.isArray(m))return {};
    return {layer:String(m.layer||""),group:String(m.group||""),
      gallery:Array.isArray(m.gallery)?m.gallery:[],
      canvas:m.canvas&&typeof m.canvas==="object"?m.canvas:null};
  }catch{return {};}
}
function extraJSON_(entry){
  return JSON.stringify({layer:entry.layer||"",group:entry.group||"",
    gallery:entry.gallery||[],canvas:entry.canvas||null});
}
function rowValues_(entry,revision,hashed){
  return [entry.id,escaped_(entry.title),entry.kind,escaped_(entry.category),
    Number(entry.lat),Number(entry.lng),escaped_(entry.notes),entry.photo||"",
    escaped_(entry.price),escaped_(entry.rating),revision,hashed,
    escaped_(entry.icon),entry.color,extraJSON_(entry)];
}
function readPins_(sh) {
  const count = Math.min(MAX_ROWS,Math.max(0,sh.getLastRow()-1));
  if (!count) return [];
  return sh.getRange(2,1,count,15).getDisplayValues()
    .filter((r)=>r[0]&&r[1]&&r[4]&&r[5])
    .map((r)=>({
      id:r[0],title:r[1],kind:r[2]||"place",category:r[3]||"",
      lat:Number(String(r[4]).replace(",",".")),lng:Number(String(r[5]).replace(",",".")),
      notes:r[6]||"",photo:r[7]||"",price:r[8]||"",rating:r[9]||"",version:r[10]||"",icon:r[12]||"📍",color:r[13]||"#245c48",
      ...readMeta_(r[14])
    })).filter((e)=>Number.isFinite(e.lat)&&Number.isFinite(e.lng));
}
function readHostels_(book) {
  const sh=book.getSheetByName(HOSTEL_TAB);
  if (!sh) return [];
  const count=Math.min(200,Math.max(0,sh.getLastRow()-3));
  if (!count) return [];
  const rg=sh.getRange(4,1,count,9);
  const rows=rg.getDisplayValues();
  const rich=rg.getRichTextValues();
  return rows.flatMap((row,i)=>{
    const title=String(row[0]||"").trim();
    if(!title||title.startsWith("Booking.com"))return [];
    const link=rich[i][5]?.getLinkUrl()||rich[i][0]?.getLinkUrl()||"";
    const found=link.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/)||link.match(/@(-?[\d.]+),(-?[\d.]+)/);
    const ja=title.toLowerCase()==="ja costa hostel";
    if(!found&&!ja)return [];
    const lat=found?Number(found[1]):21.03104,lng=found?Number(found[2]):105.855742;
    return [{id:"hostel-"+(i+1),kind:"place",source:"hostel",category:"Hostel",
      title,lat,lng,price:row[1]||"",rating:row[3]||"",bookingRating:row[2]||"",
      breakfast:row[4]||"",link,notes:"Guests liked: "+(row[7]||"")+"\\nConcerns: "+(row[8]||""),photo:""
    }];
  });
}
function output_(body,mime) {
  return ContentService.createTextOutput(body).setMimeType(mime);
}
function doGet(e) {
  const cb=String(e?.parameter?.callback||"");
  if(!/^mapCanvasCb_[a-z0-9]{8,32}$/.test(cb))return output_("Invalid callback",ContentService.MimeType.TEXT);
  try{
    const store=mapTab_();
    const result={ok:true,entries:readPins_(store.sheet),hostels:readHostels_(store.book)};
    return output_(cb+"("+JSON.stringify(result).replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029")+");",ContentService.MimeType.JAVASCRIPT);
  }catch(error){
    return output_(cb+"("+JSON.stringify({ok:false,error:String(error.message||error)})+");",ContentService.MimeType.JAVASCRIPT);
  }
}
function sha256_(key) {
  const raw=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,key,Utilities.Charset.UTF_8);
  return raw.map((byte)=>("0"+(byte&255).toString(16)).slice(-2)).join("");
}
function check_(entry) {
  if(!entry||typeof entry!=="object")throw new Error("Invalid entry.");
  if(typeof entry.id!=="string"||!/^[a-f0-9-]{36}$/.test(entry.id))throw new Error("Invalid ID");
  if(!["place","note","photo"].includes(entry.kind))throw new Error("Invalid type");
  if(typeof entry.title!=="string"||!entry.title.trim()||entry.title.length>140)throw new Error("Invalid title");
  for (const [key,max] of [["category",40],["notes",4000],["photo",38000],["price",40],["rating",30],["icon",8],["color",7]]) {
    if (typeof entry[key]!=="string"||entry[key].length>max)throw new Error("Invalid "+key);
  }
  if(!Number.isFinite(Number(entry.lat))||Math.abs(Number(entry.lat))>85||
     !Number.isFinite(Number(entry.lng))||Math.abs(Number(entry.lng))>180)throw new Error("Invalid coordinates");
  if(!/^#[0-9a-fA-F]{6}$/.test(entry.color))throw new Error("Invalid pin color");
  if(entry.layer!==undefined&&(typeof entry.layer!=="string"||entry.layer.length>40))throw new Error("Invalid layer");
  if(entry.group!==undefined&&(typeof entry.group!=="string"||entry.group.length>100))throw new Error("Invalid group");
  if(entry.gallery!==undefined){
    if(!Array.isArray(entry.gallery)||entry.gallery.length>12||
       entry.gallery.some(u=>typeof u!=="string"||u.length>2000||!/^https:\/\/\S+$/.test(u)))
      throw new Error("Invalid gallery");
  }
  if(entry.canvas!=null){
    const c=entry.canvas;
    if(typeof c!=="object"||Array.isArray(c)||
       !["image","text","line","arrow","circle"].includes(c.type)||
       (c.width!==undefined&&(!Number.isFinite(c.width)||c.width<100||c.width>420)))
      throw new Error("Invalid canvas object");
    if(["line","arrow","circle"].includes(c.type)){
      const valid=p=>Array.isArray(p)&&p.length===2&&
        Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
      if(!valid(c.start)||!valid(c.end))throw new Error("Invalid drawing coordinates");
    }
  }
  if(extraJSON_(entry).length>30000)throw new Error("Canvas metadata too large");
  if(entry.photo&&!/^https:\/\/\S+$/.test(entry.photo)&&
     !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]{20,37000}$/.test(entry.photo))
    throw new Error("Invalid photo");
}
function escaped_(string) {
  const value=String(string||"");
  return /^[=+\-@]/.test(value)?"'"+value:value;
}
function historyTab_(book){
  let sh=book.getSheetByName(HISTORY_TAB);
  if(!sh){sh=book.insertSheet(HISTORY_TAB);sh.getRange(1,1,1,7).setValues([HISTORY_HEADERS]);sh.setFrozenRows(1);}
  if(sh.getLastRow()>=MAX_HISTORY)throw new Error("History is full. Contact map owner.");
  return sh;
}
function audit_(book,action,id,before,after,revision,hashed){
  historyTab_(book).appendRow([new Date().toISOString(),action,id,
    before?JSON.stringify(before):"",after?JSON.stringify(after):"",
    revision||"",String(hashed||"").slice(0,12)]);
}

function doPost(e) {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))return output_(JSON.stringify({ok:false,error:"Busy"}),ContentService.MimeType.JSON);
  try{
    if(!e?.postData?.contents||e.postData.contents.length>125000)throw new Error("Request too large");
    const body=JSON.parse(e.postData.contents);
    const entry=body.entry;
    if(!body.key||!/^[a-f0-9]{64}$/.test(body.key))throw new Error("Edit key is missing");
    if(!["save","delete","bulk"].includes(body.action))throw new Error("Invalid action");
    if(body.action==="bulk"){
      if(!Array.isArray(body.entries)||!body.entries.length||body.entries.length>25)
        throw new Error("Bulk import accepts 1-25 pins per batch");
      body.entries.forEach(check_);
      if(body.entries.some(e=>e.version))throw new Error("Bulk import only creates new pins");
      if(new Set(body.entries.map(e=>e.id)).size!==body.entries.length)throw new Error("Duplicate import IDs");
    }else check_(entry);
    const store=mapTab_();
    const sheet=store.sheet;
    const count=Math.max(0,sheet.getLastRow()-1);
    if(count>=MAX_ROWS && body.action==="save"&&!entry.version)throw new Error("Map is full");
    const rows=count?sheet.getRange(2,1,count,15).getDisplayValues():[];
    if(body.action==="bulk"){
      const incoming=body.entries;
      if(count+incoming.length>MAX_ROWS)throw new Error("Map has reached the 500-pin limit");
      const used=new Set(rows.map(r=>r[0]));
      if(incoming.some(e=>used.has(e.id)))throw new Error("An imported pin already exists");
      historyTab_(store.book);
      if(historyTab_(store.book).getLastRow()+incoming.length>MAX_HISTORY)
        throw new Error("History storage is full");
      const hashed=sha256_(body.key);
      const values=incoming.map(e=>rowValues_(e,Utilities.getUuid(),hashed));
      const first=sheet.getLastRow()+1;
      if(first+values.length-1>sheet.getMaxRows())
        sheet.insertRowsAfter(sheet.getMaxRows(),first+values.length-1-sheet.getMaxRows());
      sheet.getRange(first,1,values.length,15).setValues(values);
      const auditRows=values.map(r=>[new Date().toISOString(),"save",r[0],"",JSON.stringify(r),r[10],hashed.slice(0,12)]);
      const h=historyTab_(store.book);
      if(h.getLastRow()+auditRows.length>h.getMaxRows())
        h.insertRowsAfter(h.getMaxRows(),h.getLastRow()+auditRows.length-h.getMaxRows());
      h.getRange(h.getLastRow()+1,1,auditRows.length,7).setValues(auditRows);
      SpreadsheetApp.flush();
      return output_(JSON.stringify({ok:true,count:incoming.length}),ContentService.MimeType.JSON);
    }
    const i=rows.findIndex((r)=>r[0]===entry.id);
    const existing=i===-1?null:rows[i];
    const hashed=sha256_(body.key);
    historyTab_(store.book);
    if(existing&&(existing[11]!==hashed||existing[10]!==entry.version))throw new Error("Edit permission or version mismatch");
    if(!existing && (body.action==="delete"||entry.version))throw new Error("Entry has changed");
    let after=null,revision="";
    if(body.action==="delete"){
      sheet.deleteRow(i+2);
    }else{
      revision=Utilities.getUuid();
      const values=rowValues_(entry,revision,hashed);
      const target=existing?i+2:sheet.getLastRow()+1;
      if(target>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),1);
      sheet.getRange(target,1,1,15).setValues([values]);
      after=values;
    }
    audit_(store.book,body.action,entry.id,existing,after,revision,hashed);
    SpreadsheetApp.flush();
    return output_(JSON.stringify({ok:true}),ContentService.MimeType.JSON);
  }catch(error){
    return output_(JSON.stringify({ok:false,error:String(error.message||error)}),ContentService.MimeType.JSON);
  }finally{lock.releaseLock();}
}

/* OWNER ONLY: run manually in Apps Script editor; never expose via doGet/doPost.
   The history tab contains full snapshots, including ownership hashes.
   Keep the workbook private and back it up before restoring. */
function mapCanvasPreviewHistory_(row){
  const book=SpreadsheetApp.openById(WORKBOOK_ID),sh=book.getSheetByName(HISTORY_TAB);
  if(!sh||!Number.isInteger(row)||row<2||row>sh.getLastRow())throw new Error("Invalid history row");
  const r=sh.getRange(row,1,1,7).getValues()[0];
  return {timestamp:r[0],action:r[1],id:r[2],
    before:r[3]?JSON.parse(r[3]):null,after:r[4]?JSON.parse(r[4]):null};
}
function mapCanvasRestoreBefore_(row){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error("Busy");
  try{
    const e=mapCanvasPreviewHistory_(row),store=mapTab_(),sh=store.sheet;
    const n=Math.max(0,sh.getLastRow()-1),rows=n?sh.getRange(2,1,n,15).getValues():[];
    const i=rows.findIndex(r=>r[0]===e.id),current=i<0?null:rows[i];
    if(e.after&&(!current||current[10]!==e.after[10]))
      throw new Error("Newer revision exists. Review manually.");
    if(!e.after&&current)throw new Error("Pin recreated. Review manually.");
    if(e.before){
      const restored=[...e.before];restored[10]=Utilities.getUuid();
      const target=i<0?sh.getLastRow()+1:i+2;
      if(target>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),1);
      sh.getRange(target,1,1,15).setValues([[...restored].concat(Array(Math.max(0,15-restored.length)).fill(""))]);
      audit_(store.book,"owner-restore",e.id,current,restored,restored[10],restored[11]);
    }else if(i>=0){
      sh.deleteRow(i+2);
      audit_(store.book,"owner-restore",e.id,current,null,"",current[11]);
    }
    SpreadsheetApp.flush();
    return "Restored "+e.id;
  }finally{lock.releaseLock();}
}

/* To recover a row from the Apps Script editor, set this number to the
   desired audit row, preview it, then run restore. Never expose this as a
   public endpoint or accept a row number from an anonymous request. */
const OWNER_RECOVERY_ROW=2;
function mapCanvasOwnerPreview(){Logger.log(JSON.stringify(mapCanvasPreviewHistory_(OWNER_RECOVERY_ROW)));}
function mapCanvasOwnerRestore(){return mapCanvasRestoreBefore_(OWNER_RECOVERY_ROW);}

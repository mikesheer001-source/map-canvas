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
function mapTab_() {
  const book = SpreadsheetApp.openById(WORKBOOK_ID);
  const sheet = book.getSheetByName(PINS_TAB);
  if (!sheet) throw new Error("Map Canvas tab not found.");
  if (sheet.getMaxColumns() < 12) sheet.insertColumnsAfter(sheet.getMaxColumns(),12-sheet.getMaxColumns());
  if (sheet.getRange(1,1,1,11).getDisplayValues()[0].join("|") !== HEADERS.slice(0,11).join("|"))
    throw new Error("Map Canvas tab headers have changed.");
  sheet.getRange(1,12).setValue(HEADERS[11]);
  return {sheet,book};
}
function readPins_(sh) {
  const count = Math.min(MAX_ROWS,Math.max(0,sh.getLastRow()-1));
  if (!count) return [];
  return sh.getRange(2,1,count,12).getDisplayValues()
    .filter((r)=>r[0]&&r[1]&&r[4]&&r[5])
    .map((r)=>({
      id:r[0],title:r[1],kind:r[2]||"place",category:r[3]||"",
      lat:Number(String(r[4]).replace(",",".")),lng:Number(String(r[5]).replace(",",".")),
      notes:r[6]||"",photo:r[7]||"",price:r[8]||"",rating:r[9]||"",version:r[10]||""
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
  for (const [key,max] of [["category",40],["notes",4000],["photo",38000],["price",40],["rating",30]]) {
    if (typeof entry[key]!=="string"||entry[key].length>max)throw new Error("Invalid "+key);
  }
  if(!Number.isFinite(Number(entry.lat))||Math.abs(Number(entry.lat))>85||
     !Number.isFinite(Number(entry.lng))||Math.abs(Number(entry.lng))>180)throw new Error("Invalid coordinates");
  if(entry.photo&&!/^https:\/\/\S+$/.test(entry.photo)&&
     !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]{20,37000}$/.test(entry.photo))
    throw new Error("Invalid photo");
}
function escaped_(string) {
  const value=String(string||"");
  return /^[=+\-@]/.test(value)?"'"+value:value;
}
function controlBurst_() {
  const props=PropertiesService.getScriptProperties();
  const hour=Math.floor(Date.now()/3600000),key="writes:"+hour;
  const n=Number(props.getProperty(key)||"0");
  if(n>=100)throw new Error("Map has hit its hourly write limit. Try again later.");
  props.setProperty(key,String(n+1));
}
function doPost(e) {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))return output_(JSON.stringify({ok:false,error:"Busy"}),ContentService.MimeType.JSON);
  try{
    if(!e?.postData?.contents||e.postData.contents.length>45000)throw new Error("Request too large");
    const body=JSON.parse(e.postData.contents);
    const entry=body.entry;
    if(!body.key||!/^[a-f0-9]{64}$/.test(body.key))throw new Error("Edit key is missing");
    if(!["save","delete"].includes(body.action))throw new Error("Invalid action");
    check_(entry);
    controlBurst_();
    const store=mapTab_();
    const sheet=store.sheet;
    const count=Math.max(0,sheet.getLastRow()-1);
    if(count>=MAX_ROWS && body.action==="save"&&!entry.version)throw new Error("Map is full");
    const rows=count?sheet.getRange(2,1,count,12).getDisplayValues():[];
    const i=rows.findIndex((r)=>r[0]===entry.id);
    const existing=i===-1?null:rows[i];
    const hashed=sha256_(body.key);
    if(existing&&(existing[11]!==hashed||existing[10]!==entry.version))throw new Error("Edit permission or version mismatch");
    if(!existing && (body.action==="delete"||entry.version))throw new Error("Entry has changed");
    if(body.action==="delete"){
      sheet.deleteRow(i+2);
    }else{
      const revision=Utilities.getUuid();
      const values=[entry.id,escaped_(entry.title),entry.kind,escaped_(entry.category),
        Number(entry.lat),Number(entry.lng),escaped_(entry.notes),entry.photo||"",
        escaped_(entry.price),escaped_(entry.rating),revision,hashed];
      const target=existing?i+2:sheet.getLastRow()+1;
      if(target>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),1);
      sheet.getRange(target,1,1,12).setValues([values]);
    }
    SpreadsheetApp.flush();
    return output_(JSON.stringify({ok:true}),ContentService.MimeType.JSON);
  }catch(error){
    return output_(JSON.stringify({ok:false,error:String(error.message||error)}),ContentService.MimeType.JSON);
  }finally{lock.releaseLock();}
}

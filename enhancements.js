// Map Canvas: public canvas tools, collections, imports, measurements and shared updates.
// No login, credentials or authoritative data are stored in this frontend.
export function parseCsvRows(input) {
  const result=[];let row=[],cell="",quoted=false;
  const source=String(input).replace(/^\uFEFF/,"");
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){
      if(c==='"'&&source[i+1]==='"'){cell+='"';i++;}
      else if(c==='"')quoted=false;
      else cell+=c;
    }else if(c==='"')quoted=true;
    else if(c===','){row.push(cell);cell="";}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&source[i+1]==='\n')i++;
      row.push(cell);if(row.some(x=>x.trim()))result.push(row);row=[];cell="";
    }else cell+=c;
  }
  if(quoted)throw new Error("Unterminated quoted CSV field.");
  row.push(cell);if(row.some(x=>x.trim()))result.push(row);
  return result;
}
export function metersBetween(a,b) {
  const rad=Math.PI/180,p1=a[1]*rad,p2=b[1]*rad;
  const dphi=(b[1]-a[1])*rad,dl=(b[0]-a[0])*rad;
  const h=Math.sin(dphi/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function polygonAreaMeters(points) {
  if(points.length<3)return 0;
  const lat0=points.reduce((v,p)=>v+p[1],0)/points.length*Math.PI/180;
  const xy=points.map(([lng,lat])=>[
    6371008.8*lng*Math.PI/180*Math.cos(lat0),6371008.8*lat*Math.PI/180]);
  return Math.abs(xy.reduce((v,p,i)=>{const next=xy[(i+1)%xy.length];return v+p[0]*next[1]-next[0]*p[1];},0))/2;
}
export function parseImport(content, filename) {
  const trimmed=String(content).trim();let raw=[];
  if(filename.toLowerCase().endsWith(".csv")){
    const [heads,...rows]=parseCsvRows(trimmed);
    if(!heads)throw new Error("Empty CSV file.");
    const labels=heads.map(x=>x.trim().toLowerCase().replace(/[^a-z0-9]/g,""));
    raw=rows.map(row=>Object.fromEntries(labels.map((key,i)=>[key,row[i]||""])));
  }else{
    const obj=JSON.parse(trimmed);
    if(obj?.type==="FeatureCollection")raw=(obj.features||[]).filter(f=>f.geometry?.type==="Point").map(f=>({
      ...f.properties,lng:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]}));
    else if(Array.isArray(obj))raw=obj;
    else if(Array.isArray(obj.entries))raw=obj.entries;
    else throw new Error("Expected a JSON array or GeoJSON Point FeatureCollection.");
  }
  if(!raw.length)throw new Error("No pin rows found.");
  if(raw.length>500)throw new Error("Import supports at most 500 pins.");
  const parsed=raw.map((x,i)=>{
    const lng=Number(x.lng??x.longitude??x.lon),lat=Number(x.lat??x.latitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>85||Math.abs(lng)>180)
      throw new Error("Missing/invalid latitude or longitude in row "+(i+1));
    const title=String(x.title||x.name||("Imported pin "+(i+1))).slice(0,140);
    let gallery=x.gallery||[];
    if(typeof gallery==="string"){
      try{gallery=JSON.parse(gallery);}catch{gallery=gallery.split(/\r?\n|\s*;\s*/).filter(Boolean);}
    }
    let canvas=x.canvas||null;
    if(typeof canvas==="string"){try{canvas=JSON.parse(canvas);}catch{canvas=null;}}
    const kind=["place","note","photo"].includes(x.kind||x.type)?(x.kind||x.type):"place";
    const rawId=String(x.id||"").trim();
    const id=/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(rawId)||/^hostel-[0-9]+$/.test(rawId)
      ?rawId:crypto.randomUUID();
    return {id,version:"local",title,kind,category:String(x.category||"").slice(0,40),
      lat,lng,notes:String(x.notes||x.description||"").slice(0,4000),
      price:String(x.price||"").slice(0,40),rating:String(x.rating||"").slice(0,30),
      icon:String(x.icon||"📍"),color:/^#[0-9a-f]{6}$/i.test(x.color)?x.color:"#245c48",
      photo:String(x.photo||x.photoUrl||"").slice(0,38000),
      layer:String(x.layer||"Imported").slice(0,40),
      group:String(x.group||"").slice(0,100),
      gallery:Array.isArray(gallery)?gallery.filter(u=>typeof u==="string" && (/^https:\/\//.test(u)||(/^data:image\/jpeg;base64,/.test(u)&&u.length<=5500))).slice(0,12):[],
      canvas:canvas&&typeof canvas==="object"?canvas:null,
      source:x.source==="hostel"?"hostel":"local",
      link:typeof x.link==="string"?x.link.slice(0,2000):"",
      breakfast:typeof x.breakfast==="string"?x.breakfast.slice(0,50):"",
      bookingRating:typeof x.bookingRating==="string"?x.bookingRating.slice(0,30):
        typeof x.bookingrating==="string"?x.bookingrating.slice(0,30):""
    };
  });
  return parsed;
}
const fmt=(m)=>m<1000?Math.round(m)+" m":(m/1000).toFixed(2)+" km";
const svgNS="http://www.w3.org/2000/svg";
const svgEl=(tag,props={})=>{
  const el=document.createElementNS(svgNS,tag);
  for(const [key,val] of Object.entries(props))el.setAttribute(key,String(val));
  return el;
};
const download=(name,content,mime)=>{
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const a=document.createElement("a");a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
};
function csvCell(val){
  const str=typeof val==="object"?JSON.stringify(val||""):String(val??"");
  const escaped=/^[=+@-]/.test(str)&&!/^-[0-9.]+$/.test(str)?"'"+str:str;
  return '"'+escaped.replace(/"/g,'""')+'"';
}

// User-facing feature switches. Only boolean keys declared here can be persisted.
// All switches are personal display/interaction preferences, not access permissions.
export const FEATURE_STORAGE_KEY="map-canvas:feature-settings-v1";
export const PIN_PHOTO_MIN_ZOOM=14;
export const FEATURE_DEFAULTS=Object.freeze({
  search:true,filters:true,layers:true,importExport:true,
  addPins:true,canvasObjects:true,galleries:true,undoRedo:true,
  labels:true,showAllPictures:false,pinRatings:false,gps:true,basemaps:true,navigation:true,darkTheme:false
});
export const FEATURE_GROUPS=[
  {title:"Map appearance",features:[
    ["darkTheme","Dark theme","Dark interface and a matching dark map"],
    ["labels","Pin labels & photo previews","Show pin labels when zoomed in"],
    ["pinRatings","Google ratings on pins","Show rating and review count under each pin emoji"],
    ["showAllPictures","Show all pictures","Show photos above their pins when zoomed in"],
    ["canvasObjects","Pictures, text & drawings","Show placed canvas objects on the map"],
    ["navigation","Map navigation buttons","Zoom in/out and fit pins"],
    ["gps","Find my location","Show the GPS location button"],
    ["basemaps","Map style selector","Switch between OpenFreeMap and OpenStreetMap"]
  ]},
  {title:"Create & edit",features:[
    ["addPins","Add pin button","Show the button for adding places"],
    ["galleries","Photo galleries","Show gallery controls and photo strips"],
    ["undoRedo","Undo & redo buttons","Show saved-change history controls"]
  ]},
  {title:"Browse & organize",features:[
    ["search","Search","Show the pin search box"],
    ["filters","Filters and sorting","Category, type, and sorting controls"],
    ["layers","Layers and groups","Show layer toggles and nested groups"],
    ["importExport","Import & export","Show CSV, JSON and GeoJSON controls"]
  ]},

];
export function readFeatureSettings(store=globalThis.localStorage){
  const defaults={...FEATURE_DEFAULTS};
  try{
    const stored=JSON.parse(store?.getItem(FEATURE_STORAGE_KEY)||"null");
    if(!stored||typeof stored!=="object"||Array.isArray(stored))return defaults;
    for(const key of Object.keys(defaults))
      if(typeof stored[key]==="boolean")defaults[key]=stored[key];
  }catch{}
  return defaults;
}
export function saveFeatureSettings(settings,store=globalThis.localStorage){
  try{
    const filtered=Object.fromEntries(Object.keys(FEATURE_DEFAULTS)
      .map(k=>[k,settings[k]===true]));
    store?.setItem(FEATURE_STORAGE_KEY,JSON.stringify(filtered));
    return !!store;
  }catch{return false;}
}

export function createSettingsControls({state,onChange}){
  const $=id=>document.getElementById(id);
  const dialog=$("settingsDialog");
  function fill(){
    const groups=$("settingsGroups");groups.replaceChildren();
    for(const group of FEATURE_GROUPS){
      const section=document.createElement("section");section.className="settings-section";
      const h=document.createElement("h3");h.textContent=group.title;section.append(h);
      for(const [key,title,description] of group.features){
        const label=document.createElement("label");label.className="settings-switch-row";
        const copy=document.createElement("span");copy.className="settings-copy";
        const name=document.createElement("strong");name.textContent=title;
        const info=document.createElement("small");info.textContent=description;
        copy.append(name,info);
        const box=document.createElement("input");
        box.type="checkbox";box.className="settings-checkbox";box.dataset.feature=key;
        box.checked=!!state.features[key];box.setAttribute("aria-label",title);
        box.addEventListener("change",()=>onChange(key,box.checked));
        label.append(copy,box);section.append(label);
      }
      groups.append(section);
    }
  }
  function sync(){
    for(const box of dialog.querySelectorAll("input[data-feature]"))
      box.checked=!!state.features[box.dataset.feature];
  }
  function init(){
    fill();
    $("settingsButton").addEventListener("click",()=>{sync();dialog.showModal();});
    const close=()=>dialog.close();
    $("settingsClose").addEventListener("click",close);
    $("settingsDone").addEventListener("click",close);
    $("settingsReset").addEventListener("click",()=>{
      for(const key of Object.keys(FEATURE_DEFAULTS))onChange(key,FEATURE_DEFAULTS[key],false);
      saveFeatureSettings(state.features);
      onChange(null,null,true);
      sync();
    });
    dialog.addEventListener("click",event=>{if(event.target===dialog)close();});
  }
  function status(saved){
    $("settingsStatus").textContent=saved?"Saved on this browser":"Could not save: browser storage blocked";
  }
  return {init,sync,status};
}

export function createEnhancements(api){
  const {state,notify,safeImage}=api;
  const $=id=>document.getElementById(id);
  let selectedLayer="all",selectedGroup="all",hiddenLayers=new Set();
  let activeTool=null,firstPoint=null,hoverPoint=null,measure=[],measureDone=false;
  let refreshBusy=false,updatingUi=false;
  let uploadedGallery=[];
  let photoFrame=0;
  const photoGroups=new Map();
  const pinPhotos=$("pinPhotos");
  const localMeta=(entry)=>({layer:entry.layer||defaultLayer(entry),group:entry.group||"",
    gallery:Array.isArray(entry.gallery)?entry.gallery:[],canvas:entry.canvas||null});
  const defaultLayer=e=>e.source==="hostel"?"Hostels":
    e.canvas?.type==="image"?"Pictures":
    ["arrow","line","circle","text"].includes(e.canvas?.type)?"Drawings":
    e.kind==="photo"?"Pictures":e.kind==="note"?"Notes":"Places";
  function visible(entries){
    if(!state.features.layers)return entries;
    return entries.filter(e=>{
      const layer=e.layer||defaultLayer(e),group=e.group||"";
      return !hiddenLayers.has(layer)&&(selectedLayer==="all"||selectedLayer===layer)
        &&(selectedGroup==="all"||group===selectedGroup||group.startsWith(selectedGroup+"/"));
    });
  }
  function selections(){
    if(updatingUi)return;updatingUi=true;
    try{
      const all=api.allEntries();
      const layers=[...new Set(all.map(e=>e.layer||defaultLayer(e)))].sort();
      const groups=[...new Set(all.flatMap(e=>{
        const path=e.group||"";if(!path)return [];
        const parts=path.split("/").filter(Boolean);
        return parts.map((_,i)=>parts.slice(0,i+1).join("/"));
      }))].sort();
      const fill=(id,items,label,selected)=>{
        const el=$(id);if(!el)return;
        const signature=items.join("\u0001");
        if(el.dataset.signature!==signature){
          el.replaceChildren(new Option(label,"all"));
          for(const item of items)el.add(new Option(item,item));
          el.dataset.signature=signature;
        }
        el.value=items.includes(selected)?selected:"all";
      };
      if(selectedLayer!=="all"&&!layers.includes(selectedLayer))selectedLayer="all";
      if(selectedGroup!=="all"&&!groups.includes(selectedGroup))selectedGroup="all";
      fill("layerFilter",layers,"All layers",selectedLayer);
      fill("groupFilter",groups,"All groups",selectedGroup);
      const toggles=$("layerToggles");
      if(toggles&&toggles.dataset.signature!==layers.join("\u0001")){
        toggles.replaceChildren();
        for(const layer of layers){
          const item=document.createElement("label");
          const input=document.createElement("input");
          input.type="checkbox";input.checked=!hiddenLayers.has(layer);
          input.addEventListener("change",()=>{
            if(input.checked)hiddenLayers.delete(layer);else hiddenLayers.add(layer);
            api.render();
          });
          item.append(input,document.createTextNode(" "+layer));
          toggles.append(item);
        }
        toggles.dataset.signature=layers.join("\u0001");
      }
      for(const [id,options] of [["layerSuggestions",layers],["groupSuggestions",groups]]){
        const el=$(id);if(!el)continue;
        el.replaceChildren(...options.map(value=>{const o=document.createElement("option");o.value=value;return o;}));
      }
    }finally{updatingUi=false;}
  }
  function project(lng,lat){
    if(!state.map)return null;
    const point=state.library==="maplibre"?state.map.project([lng,lat]):
      state.map.latLngToContainerPoint([lat,lng]);
    return {x:point.x,y:point.y};
  }
  function renderPinPhotos(){
    photoFrame=0;
    const overlay=pinPhotos;
    const zoom=api.mapZoom();
    if(!state.features.showAllPictures || !state.map || zoom<PIN_PHOTO_MIN_ZOOM){
      if(photoGroups.size)overlay.replaceChildren();
      photoGroups.clear();
      return;
    }
    const map=$("map");
    const width=map.clientWidth, height=map.clientHeight;
    const leaflet=state.library==="leaflet";
    const pane=leaflet ? state.map.getPane("mapPane") : state.map.getCanvasContainer();
    if(overlay.parentNode!==pane)pane.append(overlay);
    // Leaflet moves its map pane while panning. Keep the photo origin in viewport pixels.
    const origin=leaflet ? state.map.containerPointToLayerPoint([0,0]) : null;
    overlay.style.transform=origin ? `translate(${origin.x}px,${origin.y}px)` : "";
    if(!width || !height)return;
    const baseSize=(width<540 ? 48 : 64)*Math.max(0.43,Math.min(3.5,api.photoZoomScale(zoom)));
    const size=Math.max(baseSize,Math.min(baseSize*api.photoSize(),Math.min(width,height)*0.48));
    const maxColumns=Math.max(1,Math.floor((width+3)/(size+3)));
    const shown=new Set();
    overlay.style.setProperty("--pin-photo-size",size+"px");
    for(const entry of state.visiblePins||[]){
      const gallery=Array.isArray(entry.gallery)?entry.gallery:[];
      const urls=[...new Set([entry.photo,...gallery].map(safeImage).filter(Boolean))];
      if(!urls.length)continue;
      const p=project(entry.lng,entry.lat);
      if(!p || p.x<0 || p.x>=width || p.y<0 || p.y>=height)continue;
      shown.add(entry.id);
      const columns=Math.min(urls.length===4 ? 2 : Math.min(4,urls.length),maxColumns);
      const signature=JSON.stringify(urls);
      let group=photoGroups.get(entry.id);
      if(group?.signature!==signature){
        const node=document.createElement("div");
        node.className="pin-photo-group";
        node.dataset.pinId=entry.id;
        for(const url of urls){
          const image=document.createElement("img");
          image.alt="";
          image.decoding="async";
          image.referrerPolicy="no-referrer";
          image.addEventListener("error",()=>{image.style.visibility="hidden";},{once:true});
          image.src=url;
          node.append(image);
        }
        if(group)group.node.replaceWith(node);
        else overlay.append(node);
        group={node,signature};
        photoGroups.set(entry.id,group);
      }
      group.node.style.setProperty("--pin-photo-columns",columns);
      group.node.style.transform=`translate(${p.x}px,${p.y-22}px) translate(-50%,-100%)`;
    }
    for(const [id,{node}] of photoGroups){
      if(shown.has(id))continue;
      node.remove();
      photoGroups.delete(id);
    }
  }

  function unproject(x,y){
    if(state.library==="maplibre"){
      const p=state.map.unproject([x,y]);return [p.lng,p.lat];
    }
    const p=state.map.containerPointToLatLng([x,y]);return [p.lng,p.lat];
  }
  function viewPoint(event){
    const bounds=$("map").getBoundingClientRect();
    return [event.clientX-bounds.left,event.clientY-bounds.top];
  }
  function drawing(svg,kind,p1,p2,color,id){
    const point1=project(...p1),point2=project(...p2);
    if(!point1||!point2)return;
    let shape;
    if(kind==="circle"){
      const r=Math.hypot(point2.x-point1.x,point2.y-point1.y);
      shape=svgEl("circle",{cx:point1.x,cy:point1.y,r,stroke:color,
        "stroke-width":3,fill:color,"fill-opacity":0.12});
    }else{
      shape=svgEl("line",{x1:point1.x,y1:point1.y,x2:point2.x,y2:point2.y,
        stroke:color,"stroke-width":4,"stroke-linecap":"round"});
      if(kind==="arrow"){
        const dx=point2.x-point1.x,dy=point2.y-point1.y;
        const angle=Math.atan2(dy,dx),len=15;
        const a=svgEl("polyline",{points:[
          [point2.x-len*Math.cos(angle-.48),point2.y-len*Math.sin(angle-.48)],
          [point2.x,point2.y],
          [point2.x-len*Math.cos(angle+.48),point2.y-len*Math.sin(angle+.48)]
        ].map(p=>p.join(",")).join(" "),fill:"none",stroke:color,
        "stroke-width":4,"stroke-linejoin":"round","stroke-linecap":"round"});
        svg.append(a);
      }
    }
    svg.append(shape);
    if(id){
      shape.style.pointerEvents="stroke";
      shape.addEventListener("click",e=>{
        e.stopPropagation();
        const item=api.allEntries().find(x=>x.id===id);
        if(item)api.choose(item,false);
      });
    }
  }
  function resizeObject(el,entry){
    if(!state.localReady)return;
    let start=null;
    el.addEventListener("pointerdown",event=>{
      if(event.button!==0&&event.pointerType!=="touch")return;
      event.stopPropagation();event.preventDefault();
      start={x:event.clientX,y:event.clientY,width:entry.canvas?.width||210};
      el.setPointerCapture(event.pointerId);el.classList.add("is-dragging");
    });
    el.addEventListener("pointermove",event=>{
      if(!start)return;
      const dx=event.clientX-start.x;
      el.parentElement.style.width=Math.max(100,Math.min(420,start.width+dx))+"px";
    });
    const finish=async event=>{
      if(!start)return;
      const x=event.clientX-start.x,y=event.clientY-start.y,old=start;start=null;
      el.classList.remove("is-dragging");
      if(Math.abs(x)+Math.abs(y)<3)return;
      const updates={canvas:{...entry.canvas,width:Math.round(Math.max(100,Math.min(420,old.width+x)))}};
      await persist(entry,updates);
    };
    el.addEventListener("pointerup",finish);
    el.addEventListener("pointercancel",()=>{start=null;api.render();});
  }
  function renderOverlay(){
    if(!photoFrame&&(state.features.showAllPictures||photoGroups.size))
      photoFrame=requestAnimationFrame(renderPinPhotos);
    const objects=$("canvasObjects"),svg=$("canvasDrawing");
    if(!objects||!svg||!state.map)return;
    objects.replaceChildren();svg.replaceChildren();
    const rect=$("map").getBoundingClientRect();
    svg.setAttribute("viewBox","0 0 "+Math.max(1,rect.width)+" "+Math.max(1,rect.height));
    const expanded=api.mapZoom()>=api.DETAIL_ZOOM && state.features.canvasObjects;
    for(const entry of state.features.canvasObjects?api.filterEntries():[]){
      const c=entry.canvas;
      if(!c||!expanded)continue;
      if(["line","arrow","circle"].includes(c.type)){
        if(Array.isArray(c.start)&&Array.isArray(c.end))drawing(svg,c.type,c.start,c.end,entry.color||"#245c48",entry.id);
        continue;
      }
      if(!["image","text"].includes(c.type))continue;
      const p=project(entry.lng,entry.lat);if(!p)continue;
      const node=document.createElement("div");node.className="canvas-object "+c.type;
      node.style.left=p.x+"px";node.style.top=p.y+"px";
      node.style.width=Math.max(100,Math.min(420,Number(c.width)||210))+"px";
      const body=document.createElement(c.type==="image"?"img":"div");
      body.className="canvas-object-body";
      if(c.type==="image"){
        const url=safeImage(entry.photo)||safeImage(entry.gallery?.[0]||"");
        if(!url)continue;
        body.src=url;body.alt=entry.title||"Canvas picture";body.draggable=false;
      }else body.textContent=entry.notes||entry.title;
      const label=document.createElement("span");label.className="canvas-object-title";label.textContent=entry.title;
      node.append(body,label);
      const owned=state.localReady;
      if(owned){
        node.classList.add("can-edit");
        const handle=document.createElement("button");handle.type="button";
        handle.className="canvas-resize";handle.title="Resize object";handle.textContent="↘";
        node.append(handle);
        resizeObject(handle,entry);
      }
      node.addEventListener("click",event=>{
        if(event.target.closest(".canvas-resize"))return;
        event.stopPropagation();api.choose(entry,false);
      });
      objects.append(node);
    }

  }
  async function persist(entry,updates){
    if(!state.localReady){notify("Map still loading.",true);return;}
    if(state.saving)return;
    state.saving=true;
    try{
      const before=api.allEntries().find(x=>x.id===entry.id);
      if(!before)throw new Error("This pin is no longer available.");
      await api.submitChange("save",{...before,...updates});
      api.recordChange({before,after:api.allEntries().find(x=>x.id===entry.id)});
      notify("Saved to the shared map.");
    }catch(e){notify("Could not save change: "+e.message,true);}
    finally{state.saving=false;api.render();}
  }
  // Floating creation toolbar retired. Map clicks remain available for pin placement.
  function handleTap(){return false;}
  function makeDraft(title,kind,point){
    return {id:crypto.randomUUID(),title,kind,category:"",price:"",rating:"",
      notes:"",photo:"",version:"",icon:kind==="photo"?"📸":kind==="note"?"📝":"📍",
      color:"#245c48",lat:Number(point.lat??21),lng:Number(point.lng??105),
      layer:kind==="photo"?"Pictures":"Drawings",group:"",gallery:[],canvas:null};
  }
  function clearMeasurement(){
    activeTool=null;firstPoint=null;hoverPoint=null;measure=[];measureDone=false;
    renderOverlay();
  }
  function galleryDetail(entry,detail){
    if(!state.features.galleries)return;
    const imgs=[entry.photo,...(entry.gallery||[])].filter(x=>safeImage(x));
    if(imgs.length<2)return;
    detail.querySelector(".detail-photo")?.remove();
    const grid=document.createElement("div");grid.className="gallery-grid";
    for(const [index,src] of imgs.entries()){
      const link=document.createElement("a");link.href=src;link.target="_blank";
      link.rel="noopener noreferrer";link.setAttribute("aria-label",`Open photo ${index+1} of ${imgs.length}`);
      if(src.startsWith("data:image/"))link.addEventListener("click",event=>{
        event.preventDefault();
        const [header,encoded]=src.split(",");
        const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes],{type:header.slice(5,header.indexOf(";"))}));
        window.open(url,"_blank","noopener,noreferrer");
        setTimeout(()=>URL.revokeObjectURL(url),60000);
      });
      const image=document.createElement("img");image.src=src;image.alt=`${entry.title} photo ${index+1}`;image.loading="lazy";image.referrerPolicy="no-referrer";
      link.append(image);grid.append(link);
    }
    detail.insertBefore(grid,detail.querySelector(".detail-pills"));
  }
  function showGalleryPreviews(){
    const box=$("galleryPreview");box.replaceChildren();
    uploadedGallery.forEach((uri,i)=>{
      const wrap=document.createElement("div");wrap.className="gallery-upload-item";
      const img=document.createElement("img");img.src=uri;img.alt="Uploaded gallery photo";
      const remove=document.createElement("button");remove.type="button";remove.textContent="×";
      remove.setAttribute("aria-label","Remove gallery image");
      remove.addEventListener("click",()=>{uploadedGallery.splice(i,1);showGalleryPreviews();});
      wrap.append(img,remove);box.append(wrap);
    });
  }
  async function compressGallery(file){
    if(!file.type.startsWith("image/")||file.size>12000000)throw new Error("Choose an image below 12 MB.");
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;await img.decode();
      for(let edge=260,quality=.72;edge>=65;edge=Math.floor(edge*.8),quality=Math.max(.30,quality-.06)){
        const factor=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight));
        const c=document.createElement("canvas");
        c.width=Math.max(1,Math.round(img.naturalWidth*factor));
        c.height=Math.max(1,Math.round(img.naturalHeight*factor));
        const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);
        ctx.drawImage(img,0,0,c.width,c.height);
        const encoded=c.toDataURL("image/jpeg",quality);
        if(encoded.length<5500)return encoded;
      }
      throw new Error("Could not compress gallery image enough.");
    }finally{URL.revokeObjectURL(url);}
  }
  async function addGalleryFiles(files){
    const btn=$("galleryUpload");btn.disabled=true;
    try{
      for(const file of [...files].slice(0,12)){
        if(uploadedGallery.length>=4){notify("Upload up to 4 thumbnail images; add URLs for more.",true);break;}
        uploadedGallery.push(await compressGallery(file));
      }
      showGalleryPreviews();
    }catch(e){notify(e.message,true);}
    finally{btn.disabled=false;}
  }
  function editorOpen(entry){
    $("entryLayer").value=entry.layer||defaultLayer(entry);
    $("entryGroup").value=entry.group||"";
    uploadedGallery=(entry.gallery||[]).filter(x=>typeof x==="string"&&x.startsWith("data:image/"));
    $("galleryUrls").value=(entry.gallery||[]).filter(x=>typeof x==="string"&&x.startsWith("https://")).join("\n");
    showGalleryPreviews();
    const width=Number(entry.canvas?.width)||210;
    $("canvasWidth").value=String(width);$("canvasWidthValue").textContent=width+" px";
    $("canvasWidth").closest("label").classList.toggle("hidden",
      !["image","text"].includes(entry.canvas?.type));
  }
  function collectEditor(entry){
    entry.layer=$("entryLayer").value.trim()||defaultLayer(entry);
    entry.group=$("entryGroup").value.trim();
    if(entry.group.split("/").some(x=>x===".."||x==="."))throw new Error("Invalid group path.");
    const sources=$("galleryUrls").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(sources.length>12||sources.some(x=>!safeImage(x)||!x.startsWith("https://")||x.length>2000))
      throw new Error("Gallery supports up to 12 valid HTTPS image URLs.");
    entry.gallery=[...uploadedGallery,...sources];
    if(JSON.stringify({layer:entry.layer,group:entry.group,gallery:entry.gallery,canvas:entry.canvas}).length>30000)
      throw new Error("Gallery is too large. Use photo URLs instead.");
    if(entry.canvas&&["image","text"].includes(entry.canvas.type))
      entry.canvas={...entry.canvas,width:Number($("canvasWidth").value)};
    return entry;
  }
  async function importFile(file){
    if(!file)return;
    if(file.size>4500000){notify("File too large (max 4.5 MB).",true);return;}
    const mode=$("importMode").value;
    if(mode==="replace"&&!confirm("Replace every pin on the shared map with this file? This affects all devices."))return;
    const btn=$("importBtn");btn.disabled=true;
    try{
      const pins=parseImport(await file.text(),file.name);
      const result=await api.importPins(pins,mode);
      notify("Imported "+pins.length+" pins ("+result.added+" new, "+
        result.updated+" updated) to the shared map.");
    }catch(e){notify("Import failed: "+e.message,true);}
    finally{btn.disabled=false;}
  }
  function exportPins(){
    const format=$("exportFormat").value,entries=api.allEntries();
    if(!entries.length){notify("No matching pins to export.",true);return;}
    if(format==="json"){download("map-canvas.json",JSON.stringify(entries,null,2),"application/json");return;}
    if(format==="geojson"){
      const features=entries.map(e=>({type:"Feature",geometry:{type:"Point",coordinates:[e.lng,e.lat]},
        properties:{...e,lat:undefined,lng:undefined}}));
      download("map-canvas.geojson",JSON.stringify({type:"FeatureCollection",features},null,2),"application/geo+json");return;
    }
    const columns=["id","title","lat","lng","kind","category","layer","group","notes","price","rating","photo","gallery","canvas","icon","color","source","link","breakfast","bookingRating"];
    download("map-canvas.csv","\uFEFF"+columns.join(",")+"\n"+
      entries.map(e=>columns.map(c=>csvCell(e[c])).join(",")).join("\n"),"text/csv;charset=utf-8");
  }
  function isDrawing(){return false;}
  function init(){
    $("layerFilter").addEventListener("change",e=>{selectedLayer=e.target.value;api.render();});
    $("groupFilter").addEventListener("change",e=>{selectedGroup=e.target.value;api.render();});
    $("importBtn").addEventListener("click",()=>$("importFile").click());
    $("importFile").addEventListener("change",e=>{
      importFile(e.target.files?.[0]);e.target.value="";
    });
    $("exportBtn").addEventListener("click",exportPins);
    $("canvasWidth").addEventListener("input",e=>$("canvasWidthValue").textContent=e.target.value+" px");
    $("galleryUpload").addEventListener("click",()=>$("galleryFile").click());
    $("galleryFile").addEventListener("change",e=>{addGalleryFiles(e.target.files||[]);e.target.value="";});
    $("mapArea").addEventListener("dragover",e=>{
      if([...e.dataTransfer?.types||[]].includes("Files"))e.preventDefault();
    });
    $("mapArea").addEventListener("drop",async e=>{
      const file=[...e.dataTransfer?.files||[]].find(f=>f.type.startsWith("image/"));
      if(!file)return;e.preventDefault();
      const [x,y]=viewPoint(e),[lng,lat]=unproject(x,y);
      const draft=makeDraft("Picture","photo",{lat,lng});
      draft.kind="place";
      draft.canvas={type:"image",width:210};
      state.pendingPhoto=file;api.startPlacement("photo",draft);api.placeAt({lng,lat});
    });
    window.addEventListener("keydown",e=>{
      if(e.key==="Escape")clearMeasurement();
    });
    selections();
  }
  function updateHover(){ /* no in-progress drawing or measurement overlays */ }
  return {init,visible,selections,renderOverlay,handleTap,updateHover,isDrawing,
    galleryDetail,editorOpen,collectEditor,defaultLayer,
    clearMeasurement,persist};
}

export const OVERPASS_ENDPOINT="https://overpass-api.de/api/interpreter";
export const OSRM_ROUTE_ENDPOINT="https://router.project-osrm.org";
export const TRANSPORT_MODES=Object.freeze({
 bus:{label:"Bus",emoji:"🚌",color:"#d28a21",speed:24,buffer:8,dash:[1.5,2]},
 train:{label:"Train",emoji:"🚆",color:"#8658b5",speed:75,buffer:8,dash:[4,2]},
 flight:{label:"Flight",emoji:"✈️",color:"#397bd2",speed:800,buffer:45,dash:[2,2]},
 ferry:{label:"Ferry",emoji:"⛴️",color:"#0b91a9",speed:32,buffer:10,dash:[5,2]},
 driving:{label:"Driving",emoji:"🚗",color:"#23865b",speed:32,buffer:5,dash:[]}
});
const rad=v=>v*Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function haversineMeters(a,b){
 const p1=rad(Number(a.lat)),p2=rad(Number(b.lat)),dp=p2-p1,dl=rad(Number(b.lng)-Number(a.lng));
 const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
 return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function lineDistanceMeters(coords){
 let sum=0;for(let i=1;i<(coords||[]).length;i++)sum+=haversineMeters({lat:coords[i-1][1],lng:coords[i-1][0]},{lat:coords[i][1],lng:coords[i][0]});return sum;
}
export function greatCircleGeometry(a,b,segments=32){
 const vec=p=>{const lat=rad(p.lat),lng=rad(p.lng);return [Math.cos(lat)*Math.cos(lng),Math.cos(lat)*Math.sin(lng),Math.sin(lat)];};
 const x=vec(a),y=vec(b),omega=Math.acos(clamp(x[0]*y[0]+x[1]*y[1]+x[2]*y[2],-1,1)),s=Math.sin(omega),n=clamp(Math.floor(segments),2,128),coordinates=[];
 for(let i=0;i<=n;i++){
  const t=i/n,v=omega<1e-8||Math.abs(s)<1e-8?x.map((q,j)=>q*(1-t)+y[j]*t):x.map((q,j)=>q*Math.sin((1-t)*omega)/s+y[j]*Math.sin(t*omega)/s);
  const len=Math.hypot(...v)||1,[vx,vy,vz]=v.map(q=>q/len);
  coordinates.push([Math.atan2(vy,vx)*180/Math.PI,Math.atan2(vz,Math.hypot(vx,vy))*180/Math.PI]);
 }
 return {type:"LineString",coordinates};
}
export function formatTransportDistance(m){
 const v=Number(m);if(!Number.isFinite(v)||v<0)return "—";return v<1000?Math.round(v)+" m":(v/1000).toFixed(v>=100000?0:1)+" km";
}
export function formatTransportDuration(s){
 const v=Number(s);if(!Number.isFinite(v)||v<0)return "—";const m=Math.round(v/60),h=Math.floor(m/60),r=m%60;return h?h+" hr"+(r?" "+r+" min":""):m+" min";
}
function endpoint(p,label){
 const lat=Number(p?.lat),lng=Number(p?.lng);
 if(!p||typeof p.id!=="string"||!p.id||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>85||Math.abs(lng)>180)throw Error(label+" needs a valid map pin with latitude and longitude.");
 return {...p,lat,lng,title:String(p.title||label)};
}
function estimateTime(m,mode){const c=TRANSPORT_MODES[mode];return Math.round(m/(c.speed*1000/3600)+c.buffer*60);}
function approximate(a,b,mode,label){
 const distanceMeters=haversineMeters(a,b);
 return {geometry:mode==="flight"?greatCircleGeometry(a,b,40):{type:"LineString",coordinates:[[a.lng,a.lat],[b.lng,b.lat]]},
  distanceMeters,durationSeconds:estimateTime(distanceMeters,mode),approximate:true,source:"Geodesic estimate",
  geometryLabel:mode==="flight"?"Approximate great-circle path — actual flight corridor unavailable":label,
  timeBasis:mode==="flight"?"Typical cruise-speed estimate plus 45-minute allowance; no airline schedule":"Typical-speed estimate; no timetable or live traffic"};
}
async function driving(a,b,fetcher,signal){
 const coords=[a,b].map(p=>p.lng.toFixed(6)+","+p.lat.toFixed(6)).join(";");
 const r=await fetcher(OSRM_ROUTE_ENDPOINT+"/route/v1/driving/"+coords+"?overview=full&geometries=geojson&steps=false",{signal});
 if(!r.ok)throw Error("Driving router returned HTTP "+r.status+".");
 const d=await r.json(),v=d.routes?.[0];
 if(d.code!=="Ok"||v?.geometry?.type!=="LineString"||v.geometry.coordinates?.length<2||!Number.isFinite(Number(v.distance))||!Number.isFinite(Number(v.duration)))throw Error("No driving route geometry was returned.");
 return {geometry:v.geometry,distanceMeters:Number(v.distance),durationSeconds:Number(v.duration),approximate:false,source:"OSRM road router",geometryLabel:"Mapped road geometry (OSRM)",timeBasis:"Router driving-time estimate; no live traffic"};
}
function tag(mode){return mode==="bus"?'["route"="bus"]':mode==="train"?'["route"~"^(train|rail|subway|tram)$"]':mode==="ferry"?'["route"="ferry"]':null;}
function stitch(members,start){
 const ways=(members||[]).filter(m=>m.type==="way"&&m.geometry?.length>1).map(m=>m.geometry.filter(p=>Number.isFinite(+p.lat)&&Number.isFinite(+p.lon)).map(p=>[+p.lon,+p.lat])).filter(p=>p.length>1);
 if(!ways.length)return [];
 const d=p=>Math.min(haversineMeters(start,{lng:p[0][0],lat:p[0][1]}),haversineMeters(start,{lng:p.at(-1)[0],lat:p.at(-1)[1]}));
 let first=0;for(let i=1;i<ways.length;i++)if(d(ways[i])<d(ways[first]))first=i;
 const path=ways.splice(first,1)[0];
 if(haversineMeters(start,{lng:path.at(-1)[0],lat:path.at(-1)[1]})<haversineMeters(start,{lng:path[0][0],lat:path[0][1]}))path.reverse();
 while(ways.length){
  const end=path.at(-1);let best=-1,rev=false,dist=Infinity;
  for(let i=0;i<ways.length;i++){
   const a=haversineMeters({lng:end[0],lat:end[1]},{lng:ways[i][0][0],lat:ways[i][0][1]});
   const b=haversineMeters({lng:end[0],lat:end[1]},{lng:ways[i].at(-1)[0],lat:ways[i].at(-1)[1]});
   if(a<dist){dist=a;best=i;rev=false;}if(b<dist){dist=b;best=i;rev=true;}
  }
  if(best<0||dist>500)break;const next=ways.splice(best,1)[0];if(rev)next.reverse();path.push(...next.slice(1));
 }
 return path;
}
function nearest(coords,p){
 let index=-1,distance=Infinity;for(let i=0;i<coords.length;i++){const d=haversineMeters(p,{lng:coords[i][0],lat:coords[i][1]});if(d<distance){distance=d;index=i;}}return {index,distance};
}
async function mappedTransit(a,b,mode,fetcher,signal){
 const q='[out:json][timeout:18];relation(around:3000,'+a.lat.toFixed(5)+','+a.lng.toFixed(5)+')'+tag(mode)+';out geom;';
 const r=await fetcher(OVERPASS_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",Accept:"application/json"},body:"data="+encodeURIComponent(q),signal});
 if(!r.ok)throw Error("OpenStreetMap route lookup returned HTTP "+r.status+".");
 const data=await r.json();let best=null;
 for(const rel of data.elements||[]){
  if(rel.type!=="relation"||!rel.tags?.route)continue;
  const path=stitch(rel.members,a);if(path.length<2)continue;
  const x=nearest(path,a),y=nearest(path,b);if(x.distance>2500||y.distance>2500||x.index===y.index)continue;
  const coords=x.index<=y.index?path.slice(x.index,y.index+1):path.slice(y.index,x.index+1).reverse(),score=x.distance+y.distance;
  if(coords.length<2||best&&score>=best.score)continue;
  const name=String(rel.tags.name||rel.tags.ref||"").trim();
  best={score,geometry:{type:"LineString",coordinates:coords},distanceMeters:lineDistanceMeters(coords),source:"OpenStreetMap route relation",
   geometryLabel:"Mapped "+TRANSPORT_MODES[mode].label.toLowerCase()+" route geometry"+(name?" · "+name:""),relationName:name};
 }
 return best;
}
export async function buildMultimodalRoute(options){
 const mode=options?.mode;if(!Object.hasOwn(TRANSPORT_MODES,mode))throw Error("Choose bus, train, flight, ferry or driving.");
 const from=endpoint(options.from,"Start"),to=endpoint(options.to,"Destination");if(from.id===to.id)throw Error("Choose two different pins for a transport route.");
 const fetcher=options.fetchImpl||globalThis.fetch,signal=options.signal;if(typeof fetcher!=="function")throw Error("This browser does not support route lookups.");
 let result;
 if(mode==="flight")result=approximate(from,to,mode);
 else if(mode==="driving"){
  try{result=await driving(from,to,fetcher,signal);}
  catch(e){if(e.name==="AbortError"||signal?.aborted)throw e;result=approximate(from,to,mode,"Approximate straight line — driving router unavailable");result.fallbackReason=e.message;}
 }else{
  try{
   const route=await mappedTransit(from,to,mode,fetcher,signal);
   result=route?{geometry:route.geometry,distanceMeters:route.distanceMeters,durationSeconds:estimateTime(route.distanceMeters,mode),approximate:false,source:route.source,
    geometryLabel:route.geometryLabel,timeBasis:"Typical "+mode+" speed estimate; no timetable or live service data",relationName:route.relationName||""}:
    approximate(from,to,mode,"Approximate straight line — no matching mapped "+mode+" route found");
  }catch(e){if(e.name==="AbortError"||signal?.aborted)throw e;result=approximate(from,to,mode,"Approximate straight line — OpenStreetMap route lookup unavailable");result.fallbackReason=e.message;}
 }
 return {id:String(options.id||globalThis.crypto?.randomUUID?.()||("transport-"+Date.now()+"-"+Math.random().toString(36).slice(2))),
  mode,modeLabel:TRANSPORT_MODES[mode].label,from:{id:from.id,title:from.title,lat:from.lat,lng:from.lng},to:{id:to.id,title:to.title,lat:to.lat,lng:to.lng},...result};
}

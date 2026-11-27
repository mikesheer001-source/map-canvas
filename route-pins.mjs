// User-requested road and path geometry. No straight-line fallback.
export const ROUTE_PIN_MODES=Object.freeze({driving:"car",walking:"foot",cycling:"bike"});
export function decodeRoutePolyline(encoded){
  if(typeof encoded!=="string"||encoded.length>20000)return [];
  let i=0,lat=0,lng=0,points=[];
  function delta(){let result=0,shift=0,byte;do{if(i>=encoded.length||shift>30)throw Error("Invalid route geometry");byte=encoded.charCodeAt(i++)-63;if(byte<0||byte>63)throw Error("Invalid route geometry");result|=(byte&31)<<shift;shift+=5;}while(byte>=32);return result&1?~(result>>1):result>>1;}
  try{while(i<encoded.length){lat+=delta();lng+=delta();const point=[lng/1e5,lat/1e5];if(Math.abs(point[0])>180||Math.abs(point[1])>85)throw Error("Invalid route point");points.push(point);}}catch{return [];}
  return points.length>=2?points:[];
}
const rad=x=>x*Math.PI/180;
function distance(a,b){const dlat=rad(b[1]-a[1]),dlng=rad(b[0]-a[0]);const h=Math.sin(dlat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dlng/2)**2;return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(h)));}
export function routePathMidpoint(points){
  const lengths=points.slice(1).map((p,i)=>distance(points[i],p));let left=lengths.reduce((a,b)=>a+b,0)/2;
  for(let i=0;i<lengths.length;i++){if(left<=lengths[i]&&lengths[i]>0){const t=left/lengths[i],a=points[i],b=points[i+1];return {lng:a[0]+(b[0]-a[0])*t,lat:a[1]+(b[1]-a[1])*t};}left-=lengths[i];}
  return {lng:points[0][0],lat:points[0][1]};
}
let lastRequest=0;
export async function fetchRoutePin(start,end,mode,{fetchImpl=globalThis.fetch,signal}={}){
  if(!Object.hasOwn(ROUTE_PIN_MODES,mode))throw Error("Choose driving, walking or cycling.");
  if(![start,end].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85))throw Error("Invalid route endpoints.");
  const wait=Math.max(0,1100-(Date.now()-lastRequest));if(wait)await new Promise(r=>setTimeout(r,wait));if(signal?.aborted)throw new DOMException("Cancelled","AbortError");lastRequest=Date.now();
  const base="https://routing.openstreetmap.de/routed-"+ROUTE_PIN_MODES[mode];
  const coordinates=[start,end].map(p=>p.map(x=>x.toFixed(6)).join(",")).join(";");
  const response=await fetchImpl(base+"/route/v1/driving/"+coordinates+"?overview=full&geometries=polyline&steps=false&radiuses=300;300",{signal,headers:{Accept:"application/json"}});
  if(!response.ok)throw Error("Routing service HTTP "+response.status+".");
  const data=await response.json(),route=data.routes?.[0],points=decodeRoutePolyline(route?.geometry);
  if(data.code!=="Ok"||points.length<2||!Number.isFinite(route.distance)||route.distance<=0||!Number.isFinite(route.duration)||route.duration<0)throw Error("No usable mapped route found. Choose points closer to mapped roads or paths.");
  if(distance(start,points[0])>350||distance(end,points.at(-1))>350)throw Error("Route endpoints could not be matched to nearby roads or paths.");
  return {center:routePathMidpoint(points),canvas:{type:"route",start,end,mode,polyline:route.geometry,distanceMeters:route.distance,durationSeconds:route.duration,source:"OSRM / FOSSGIS / OpenStreetMap"}};
}

import test from "node:test";
import assert from "node:assert/strict";
import {decodeRoutePolyline,routePathMidpoint,fetchRoutePin} from "../route-pins.mjs";
test("decode full mapped geometry and place marker along route",()=>{
  const p=decodeRoutePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(p,[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]);
  assert.equal(decodeRoutePolyline("!").length,0);
  assert.deepEqual(routePathMidpoint([[0,0],[1,0],[1,1]]),{lng:1,lat:0});
});
test("route lookup uses walking profile and never invents a straight line",async()=>{
  const start=[-120.2,38.5],end=[-126.453,43.252];
  let url="";
  const good=await fetchRoutePin(start,end,"walking",{fetchImpl:async u=>{url=u;return {ok:true,json:async()=>({code:"Ok",routes:[{geometry:"_p~iF~ps|U_ulLnnqC_mqNvxq`@",distance:500000,duration:50000}]})}}});
  assert.match(url,/routed-foot/);assert.equal(good.canvas.mode,"walking");assert.equal(decodeRoutePolyline(good.canvas.polyline).length,3);
  await assert.rejects(fetchRoutePin(start,end,"driving",{fetchImpl:async()=>({ok:true,json:async()=>({code:"NoRoute"})})}),/No usable mapped route/);
});
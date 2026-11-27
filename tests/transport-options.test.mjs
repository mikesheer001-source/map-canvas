import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTransitousPlanUrl, extractFareSummary, normalizeTransitousResponse,
  rankTransportOptions, isResearchStale, buildExternalTransportLinks,
  searchTransportOptions, toLocalDateTimeISO, PRICE_STALE_AFTER_MS
} from "../transport-options.mjs";

const route = { id:"route-1", from:{id:"a",title:"Hanoi",lat:21.0285,lng:105.8542}, to:{id:"b",title:"Da Nang",lat:16.0544,lng:108.2022} };
const date = "2026-11-28T08:00:00+07:00";
const product = (name,amount,currency="VND")=>({name,amount,currency});
function itinerary(id,overrides={}) {
 return {id,startTime:"2026-11-28T09:00:00+07:00",endTime:"2026-11-28T15:00:00+07:00",duration:21600,transfers:1,
  fareTransfers:[{rule:"A_AB_B",effectiveFareLegProducts:[[[product("Adult ticket",180000)],[product("Day pass",220000)]],[[product("Connection ticket",30000)]]],transferProducts:[]}],
  legs:[
   {mode:"BUS",agencyName:"Test Bus",agencyUrl:"https://operator.example",agencyFareUrl:"https://operator.example/tickets",routeShortName:"B12",
    from:{name:"Hanoi",tz:"Asia/Ho_Chi_Minh"},to:{name:"Stop A"},startTime:"2026-11-28T09:00:00+07:00",endTime:"2026-11-28T12:00:00+07:00",
    intermediateStops:[{name:"One"},{name:"Two"}],realTime:true},
   {mode:"BUS",agencyName:"Test Bus",from:{name:"Stop A"},to:{name:"Da Nang"},startTime:"2026-11-28T12:20:00+07:00",endTime:"2026-11-28T15:00:00+07:00",intermediateStops:[]}
  ],...overrides};
}

test("builds versioned Transitous query with coordinates, departure, fare request and modes",()=>{
 const url=new URL(buildTransitousPlanUrl(route,date));
 assert.equal(url.origin,"https://api.transitous.org");assert.equal(url.pathname,"/api/v6/plan");
 assert.equal(url.searchParams.get("fromPlace"),"21.028500,105.854200");assert.equal(url.searchParams.get("toPlace"),"16.054400,108.202200");
 assert.equal(url.searchParams.get("time"),date);assert.equal(url.searchParams.get("withFares"),"true");
 assert.equal(url.searchParams.get("transitModes"),"TRANSIT");assert.equal(url.searchParams.get("directModes"),"CAR");
 assert.equal(url.searchParams.get("searchWindow"),"43200");
});
test("extracts fare bundles without inventing or mixing currencies",()=>{
 const fare=extractFareSummary(itinerary("fare"));assert.equal(fare.amount,210000);assert.equal(fare.currency,"VND");
 assert.deepEqual(fare.products.map(item=>item.name),["Adult ticket","Connection ticket"]);
 assert.equal(extractFareSummary({fareTransfers:[]}),null);
 assert.equal(extractFareSummary({fareTransfers:[{rule:"A_AB_B",effectiveFareLegProducts:[[product("USD",2,"USD")],[product("VND",3,"VND")]]}]}),null);
});
test("normalizes operators, schedules, stops, transfers, fares and booking links",()=>{
 const research=normalizeTransitousResponse({itineraries:[itinerary("one")],direct:[]},route,date,"2026-11-27T02:00:00Z");
 assert.equal(research.status,"success");assert.equal(research.options.length,1);
 const option=research.options[0];assert.equal(option.mode,"bus");assert.equal(option.operatorLabel,"Test Bus");
 assert.equal(option.transfers,1);assert.equal(option.stops,2);assert.equal(option.fare.amount,210000);
 assert.equal(option.fare.currency,"VND");assert.equal(option.bookingLinks[0].url,"https://operator.example/tickets");
 assert.equal(option.realTime,true);assert.equal(research.sources[0].checkedAt,"2026-11-27T02:00:00Z");
});
test("normalizes direct car options and supplies driving directions rather than a bus booking link",()=>{
 const direct={id:"car",duration:9000,transfers:0,startTime:date,endTime:"2026-11-28T10:30:00+07:00",
  legs:[{mode:"CAR",from:{name:"A"},to:{name:"B"},duration:9000}]};
 const research=normalizeTransitousResponse({itineraries:[],direct:[direct]},route,date);
 const option=research.options[0];assert.equal(option.mode,"driving");assert.equal(option.fare,null);
 assert.equal(option.priceStatus,"not-provided");assert.match(option.bookingLinks[0].url,/google\.com\/maps\/dir/);
});
test("filters cancelled options and duplicate itinerary cards",()=>{
 const a=itinerary("a"),b={...itinerary("b"),id:"b"},cancelled={...itinerary("c"),cancelled:true};
 const research=normalizeTransitousResponse({itineraries:[a,b,cancelled],direct:[]},route,date);
 assert.equal(research.options.length,1);
});
test("cheapest and best-value picks use priced options only when coverage is partial",()=>{
 const options=[
  {id:"slow-cheap",durationSeconds:1200,fare:{amount:5,currency:"USD"}},
  {id:"fast",durationSeconds:900,fare:{amount:8,currency:"USD"}},
  {id:"unknown",durationSeconds:800,fare:null}
 ];
 const partial=rankTransportOptions(options);assert.equal(partial.fastest,"unknown");assert.equal(partial.cheapest,"slow-cheap");assert.equal(partial.bestValue,"fast");assert.equal(partial.priceCoverageComplete,false);
 assert.match(partial.cheapestReason,/excluded/);assert.match(partial.bestValueReason,/excluded/);
 const complete=rankTransportOptions(options.slice(0,2));assert.equal(complete.cheapest,"slow-cheap");assert.equal(complete.fastest,"fast");assert.equal(complete.bestValue,"fast");assert.equal(complete.priceCoverageComplete,true);
});
test("does not compare prices across currencies",()=>{
 const result=rankTransportOptions([{id:"usd",durationSeconds:100,fare:{amount:5,currency:"USD"}},{id:"eur",durationSeconds:120,fare:{amount:4,currency:"EUR"}}]);
 assert.equal(result.cheapest,null);assert.equal(result.bestValue,null);
});
test("flags research older than one day as stale",()=>{
 const now=Date.parse("2026-11-27T12:00:00Z");
 assert.equal(isResearchStale({researchedAt:new Date(now-PRICE_STALE_AFTER_MS+1).toISOString()},now),false);
 assert.equal(isResearchStale({researchedAt:new Date(now-PRICE_STALE_AFTER_MS-1).toISOString()},now),true);
 assert.equal(isResearchStale(null,now),true);
});
test("builds external provider search links without treating them as researched fares",()=>{
 const links=buildExternalTransportLinks(route,"2026-11-28");
 assert.equal(links.twelveGo,"https://12go.asia/en/travel/hanoi/da-nang");
 assert.match(links.flights,/google\.com\/travel\/flights/);assert.match(links.driving,/google\.com\/maps\/dir/);
 assert.equal(buildExternalTransportLinks({from:{title:"Hotel 17, District 1"},to:{title:"Terminal 3"}}).twelveGo,"https://12go.asia/en");
});
test("uses mock API response and records research timestamp and source links",async()=>{
 let requested="";
 const result=await searchTransportOptions(route,date,{now:"2026-11-27T02:00:00Z",fetchImpl:async url=>{
  requested=url;return {ok:true,status:200,json:async()=>({itineraries:[itinerary("one")],direct:[]})};
 }});
 assert.match(requested,/withFares=true/);assert.equal(result.researchedAt,"2026-11-27T02:00:00.000Z");
 assert.equal(result.options[0].fare.amount,210000);assert.ok(result.sources.some(source=>source.url==="https://transitous.org/sources/"));
});
test("surfaces provider failures instead of fabricating options",async()=>{
 await assert.rejects(()=>searchTransportOptions(route,date,{fetchImpl:async()=>({ok:false,status:503,json:async()=>({})})}),/HTTP 503/);
 await assert.rejects(()=>searchTransportOptions({from:{},to:{}},date),/valid start and destination coordinates/);
});
test("formats a selected departure as ISO date-time with local offset",()=>{
 assert.match(toLocalDateTimeISO("2026-11-28","08:15"),/^2026-11-28T08:15:00[+-]\d{2}:\d{2}$/);
});

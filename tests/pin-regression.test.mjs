/**
 * Pin regression tests. Run with: node tests/pin-regression.test.mjs
 * Exercises coordinate order, native WebGL layers, style switching,
 * zoom-gated HTML labels, moving, and native SVG fallback.
 * Intentionally mocks the DOM/map to run without network or browser plugins.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import { FEATURE_DEFAULTS } from "../enhancements.js";
const app = readFileSync(new URL("../app.js",import.meta.url),"utf8");
const css = readFileSync(new URL("../style.css",import.meta.url),"utf8");
assert.match(css, /\.canvas-pin\{position:absolute/);
assert.match(css, /\.maplibregl-marker\.canvas-pin\{position:absolute/);
assert.ok(app.includes('style.load'));
assert.ok(app.includes('circleMarker'));
assert.ok(app.includes('type:"geojson",data'));

class Element {
  constructor(tag="div"){
    this.tagName=tag.toUpperCase();this.style={};this.children=[];this.attrs={};
    this.classList={ add() {},remove(){},toggle(){} };
    this.textContent="";
  }
  append(...children){this.children.push(...children);}
  appendChild(child){this.children.push(child);return child;}
  setAttribute(k,v){this.attrs[k]=v;}
  querySelectorAll(){return [];}
  querySelector(sel){return this.children.find(x=>sel===".pin-label"&&x.className==="pin-label")??null;}
  get outerHTML(){return "<span class='pin-label'></span>";}
}
const dom = {
  getElementById(id){if(!this.nodes[id])this.nodes[id]=new Element();return this.nodes[id]},
  createElement(tag){return new Element(tag)},nodes:{}
};
class Marker {
  constructor(options){this.options=options;Marker.created.push(this);}
  setLngLat(ll){this.ll=ll;return this;}
  addTo(map){this.map=map;return this;}
  remove(){this.removed=true;}
}
Marker.created=[];
const fakeWindow={maplibregl:{Marker},L:null};
const appForTest=app.replace(/^import .*;\s*/,"").replace(/main\(\)\.catch\([^;]*;\s*$/,"");
assert.notEqual(appForTest.length,app.length,"test runner must suppress the startup sequence");
const api=new Function("document","window","location","FEATURE_DEFAULTS",appForTest+
  "\nreturn {state,renderMarkers,pinGeoJSON,updateLabels,changeProvider,filterEntries};")(dom,fakeWindow,{hostname:"test.invalid"},FEATURE_DEFAULTS);
const {state,renderMarkers,pinGeoJSON,updateLabels,changeProvider}=api;
const hostels=[
  {id:"hostel-1",title:"North",kind:"place",lat:21.0342937,lng:105.8526123,price:"$4.25",rating:"4.6"},
  {id:"hostel-2",title:"East",kind:"place",lat:21.0329587,lng:105.8442971,price:"$4.35",rating:"4.5"},
  {id:"note-1",title:"Note",kind:"note",lat:21.0369192,lng:105.8500837,notes:"test"},
  {id:"photo-1",title:"Photo",kind:"photo",lat:21.0295722,lng:105.8441379,
    photo:"https://example.com/image.jpg"}
];
assert.deepEqual(pinGeoJSON(hostels).features.map(x=>x.geometry.coordinates),
  hostels.map(x=>[x.lng,x.lat]),"GeoJSON coordinates must be [longitude, latitude]");
assert.equal(pinGeoJSON([...hostels,{id:"bad",lat:"NaN",lng:105}]).features.length,4);
state.hostels=hostels;state.entries=[];state.visiblePins=hostels;state.current=null;state.showLabels=true;
class Map {
  constructor(){this.sources=new MapStore();this.layers=new MapStore();this.events=[];this.zoom=15.5;this.canvas={style:{}};}
  getSource(id){return this.sources.get(id);}
  getLayer(id){return this.layers.get(id);}
  addSource(id,s){const source={...s,setData(d){this.data=d}};this.sources.set(id,source);}
  addLayer(l){this.layers.set(l.id,l);}
  setPaintProperty(id,k,value){this.layers.get(id).paint[k]=value;}
  on(...args){this.events.push(args);}
  getZoom(){return this.zoom;}
  getCanvas(){return this.canvas;}
  setStyle(style){this.nextStyle=style;this.layers.clear();this.sources.clear();}
}
class MapStore{
  constructor(){this.store=new globalThis.Map();}
  get(k){return this.store.get(k);}
  set(k,v){return this.store.set(k,v);}
  clear(){return this.store.clear();}
}
const map=new Map();
state.map=map;state.library="maplibre";state.styleReady=false;
renderMarkers(hostels);
assert.equal(map.layers.store.size,0,"No layers before style ready");
state.styleReady=true;
renderMarkers(hostels);
assert.deepEqual([...map.layers.store.keys()],["canvas-clusters","canvas-cluster-count","canvas-pin-halo","canvas-pin-dots","canvas-pin-touch-targets"]);
assert.equal(map.getSource("canvas-geo-pins").data.features.length,4);
assert.equal(map.getSource("canvas-geo-pins").cluster,true,"Map source enables clustering");
assert.equal(map.events.filter(x=>x[0]==="click" && x[1]==="canvas-pin-touch-targets").length,1,"Only one delegated click handler");
renderMarkers(hostels.slice(0,2));
assert.equal(map.getSource("canvas-geo-pins").data.features.length,2);
assert.equal(map.events.filter(x=>x[0]==="click" && x[1]==="canvas-pin-touch-targets").length,1,"No duplicate click handlers");
assert.equal(Marker.created.length,0,"No DOM markers for overview dots");
map.zoom=17.2;
renderMarkers(hostels);
assert.equal(state.labelMarkers.length,4,"Text/photos visible when zoomed in");
for (const m of state.labelMarkers) {
  assert.equal(m.options.element.style.pointerEvents,"none");
  assert.ok(hostels.some(e=>e.lng===m.ll[0]&&e.lat===m.ll[1]));
}
state.mapMoving=true;updateLabels();
assert.equal(state.labelMarkers.length,0,"Labels hidden during pinch/drag, map-native dots remain");
assert.equal(map.getSource("canvas-geo-pins").data.features.length,4);
state.mapMoving=false;updateLabels();
assert.equal(state.labelMarkers.length,4);
map.zoom=14;updateLabels();assert.equal(state.labelMarkers.length,0,"Zoom-out hides label cards");
changeProvider("openstreetmap");
assert.equal(state.styleReady,false);
assert.equal(map.layers.store.size,0);
state.styleReady=true;renderMarkers(hostels);
assert.equal(map.layers.store.size,5,"Native pins and clusters restored after style switch");
changeProvider("openfreemap");
state.styleReady=true;renderMarkers(hostels);
assert.equal(map.getSource("canvas-geo-pins").data.features.length,4);

let leaf=[]
const leaflet={
  circleMarker(latlng,options){
    const m={latlng,options,addTo(){leaf.push(this);return this;},
      on(_,cb){this.click=cb;return this;},remove(){this.removed=true}};
    return m;
  },
  marker(latlng,options){return {addTo(){return this},remove(){}};},
  divIcon(args){return args}
};
fakeWindow.L=leaflet;state.library="leaflet";state.markers=[];state.map={getZoom:()=>14};
renderMarkers(hostels);
assert.equal(leaf.length,4);
assert.deepEqual(leaf[0].latlng,[hostels[0].lat,hostels[0].lng],
  "Leaflet uses [latitude, longitude]");
assert.ok(leaf.every(x=>x.options.bubblingMouseEvents===false));
console.log("PASS: coordinates, clustering, styles, label zoom gating, gestures, fallback");

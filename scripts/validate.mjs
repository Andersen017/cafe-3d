import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {walkBlocked,groundAt,moveWalker,inPolygon} from './walk.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const json=await fs.readFile(path.join(root,'model/canonical.json'),'utf8');
const data=JSON.parse(json);const passed=[];
function check(name,fn){fn();passed.push(name);}
check('Public model contains no local paths, contacts or private source contents',()=>{
  assert(!/[A-Za-z]:[\\/]|@|\.dwg|\.pdf|\.xlsx|\.dxf/i.test(json));
});
check('Unique stable element identifiers and complete layer/source references',()=>{
  assert.equal(new Set(data.elements.map(e=>e.id)).size,data.elements.length);
  for(const e of data.elements){assert(data.layers.some(l=>l.id===e.layer));assert(e.sources.every(s=>data.sources.some(src=>src.id===s)));}
});
check('AR source dimensions, roof pitch and independent original KM reference',()=>{
  assert.equal(data.parameters.axisWidth,10.6);assert.equal(data.parameters.axisDepth,10.6);
  assert.equal(data.parameters.ceilingHeight,3.3);assert.equal(data.parameters.doorHeight,2.1);
  assert.equal(data.parameters.roofPitchDegrees,3);assert.equal(data.parameters.referenceKMPitchDegrees,5);
  assert.equal(data.elements.filter(e=>e.layer==='km.reference').length,280);
  const roof=data.elements.find(e=>e.layer==='ar.roof.core');assert(Math.abs(Math.atan(roof.geometry.slope)*180/Math.PI-3)<1e-7);
});
check('Eight room areas agree with the AR explication (tolerance 0.02 m² per room)',()=>{
  const rooms=data.rooms.filter(r=>!['entrance','terrace'].includes(r.id));
  assert.equal(rooms.length,8);assert(Math.abs(rooms.reduce((a,r)=>a+r.area,0)-103.25)<1e-8);
  for(const r of rooms){const p=r.points;const area=Math.abs(p.reduce((a,point,i)=>{const b=p[(i+1)%p.length];return a+point[0]*b[1]-b[0]*point[1];},0)/2);assert(Math.abs(area-r.area)<.02,`${r.id}: ${area} vs ${r.area}`);}
});
check('Room floor and exterior step use their source elevations',()=>{
  assert.equal(groundAt(7,-2,data),0);assert.equal(groundAt(7,1.8,data),-.15);assert.equal(groundAt(5.8,-12.4,data),-.15);
});
check('All walk starts are clear, walls and service glazing block movement',()=>{
  for(const s of data.walk.starts)assert(!walkBlocked(s.position[0],s.position[2],data),s.id);
  assert(walkBlocked(3.12,-1,data));assert(walkBlocked(10.6,-5,data));assert(walkBlocked(0,-5,data));
  assert(!walkBlocked(7.05,0,data));assert(!walkBlocked(5.88,-10.6,data));
});
check('Fast movement cannot tunnel through a partition',()=>{
  const p=moveWalker([2.6,-1],3,0,data);assert(p[0]<3.02);assert(p[0]>2.7);
});
check('Staff entrance and corridor can be traversed through actual clear door holes',()=>{
  const p=moveWalker([7.05,1.8],0,-5.9,data);assert(p[1]<-4);
});
check('Every room and both terraces are reachable on the physical walk map',()=>{
  const step=.07,x0=-1,z0=-18,nx=187,nz=310;
  const states=new Uint8Array(nx*nz),queue=new Int32Array(nx*nz);let head=0,tail=0;
  const ix=Math.round((7.05-x0)/step),iz=Math.round((1.8-z0)/step),start=iz*nx+ix;
  states[start]=2;queue[tail++]=start;const reached=new Set();
  while(head<tail){
    const cell=queue[head++],x=cell%nx,z=Math.floor(cell/nx),px=x0+x*step,pz=z0+z*step;
    for(const r of data.rooms)if(!reached.has(r.id)&&inPolygon(px,pz,r.points))reached.add(r.id);
    for(const [a,b] of [[x+1,z],[x-1,z],[x,z+1],[x,z-1]]){
      if(a<0||a>=nx||b<0||b>=nz)continue;const next=b*nx+a;if(states[next])continue;
      states[next]=1;if(walkBlocked(x0+a*step,z0+b*step,data))continue;
      states[next]=2;queue[tail++]=next;
    }
  }
  const missing=data.rooms.filter(r=>!reached.has(r.id)).map(r=>r.id);assert.deepEqual(missing,[]);
});

const bytes=await fs.readFile(path.join(root,'assets/cafe.glb'));
assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
check('Exported GLB independently loads with all layers and element IDs',()=>{
  const layerIds=new Set(),ids=new Set();let meshes=0;
  gltf.scene.traverse(o=>{if(o.userData.layerId&&!o.userData.elementId)layerIds.add(o.userData.layerId);if(o.userData.elementId)ids.add(o.userData.elementId);if(o.isMesh){meshes++;for(const n of o.geometry.attributes.position.array)assert(Number.isFinite(n));}});
  assert.equal(layerIds.size,data.layers.length);assert.equal(ids.size,data.elements.length);assert(meshes>data.elements.length);
  const b=new THREE.Box3().setFromObject(gltf.scene);assert(b.max.y>4.93&&b.max.y<4.95);assert(b.min.z<=-19.99);
});
const stats={result:'PASS',checks:passed,glbBytes:bytes.length,revision:data.revision};
await fs.mkdir(path.join(root,'.work'),{recursive:true});await fs.writeFile(path.join(root,'.work/validation.json'),JSON.stringify(stats,null,2));
console.log(JSON.stringify(stats,null,2));

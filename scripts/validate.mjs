import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {walkBlocked,groundAt,moveWalker,inPolygon} from './walk.mjs';
import {includedElements,variantById} from './variants.mjs';
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
check('Source plan dimensions and coherent 3° LSTK / 5° KM assemblies',()=>{
  assert.equal(data.parameters.axisWidth,10.6);assert.equal(data.parameters.axisDepth,10.6);
  assert.equal(data.parameters.ceilingHeight,3.3);assert.equal(data.parameters.doorHeight,2.1);
  assert.equal(data.parameters.roofPitchDegrees,3);assert.equal(data.parameters.referenceKMPitchDegrees,5);
  assert.equal(data.elements.filter(e=>e.layer==='km.reference').length,280);
  assert.equal(data.parameters.sourceGeometryAuthority,'LSTK');assert.equal(data.parameters.lstkFrameTop,5.01);
  assert.equal(data.variants.default,'lstk');assert.equal(variantById(data,'invalid').id,'lstk');
  for(const v of ['lstk','km']){
    const es=includedElements(data,v);assert(es.every(e=>!e.variant||e.variant===v));
    for(const layer of ['ar.walls.core','ar.walls.inner','ar.walls.outer','ar.roof.core','ar.roof.inner','ar.roof.outer','ar.canopy','design.exterior'])assert(es.some(e=>e.layer===layer&&e.variant===v),`${v}: ${layer}`);
    assert(variantById(data,v).frameLayers.every(l=>es.some(e=>e.layer===l&&e.variant===v)));
    const roof=es.find(e=>e.layer==='ar.roof.core');assert(Math.abs(Math.atan(roof.geometry.slope)*180/Math.PI-(v==='lstk'?3:5))<1e-7);
  }
  const km=data.elements.filter(e=>e.layer==='km.reference');
  assert.equal(createHash('sha256').update(JSON.stringify(km.map(e=>[e.id,e.geometry]))).digest('hex'),'7ed35bf93c7c020610dc83c29c3242315ffdc82a3c581f92caeaded50e320a70');
});
check('Catalogue references and quantities; D22 placed, three unassigned units retained',()=>{
  assert.equal(data.issues.length,0);
  for(const e of data.elements){
    assert(!e.properties['Расхождение']&&!e.properties['Коллизия'],e.id);
    assert(data.materials[e.material]);if(e.variant)assert(data.variants.options.some(v=>v.id===e.variant));
    if(e.catalogId)assert(data.catalog.some(c=>c.id===e.catalogId&&c.placedIds.includes(e.id)));
  }
  assert.equal(new Set(data.catalog.map(c=>c.id)).size,data.catalog.length);
  for(const c of data.catalog){assert.equal(c.quantity,c.placedIds.length+c.unplacedQuantity,c.id);assert(c.unplacedQuantity>=0);for(const id of c.placedIds)assert(data.elements.some(e=>e.id===id&&e.catalogId===c.id));}
  const c=id=>data.catalog.find(c=>c.id===id);
  assert.deepEqual(c('equipment.D22').placedIds,['tx-32EE9F']);assert.equal(c('equipment.D12').quantity,2);assert.equal(c('equipment.D12').placedIds.length,1);
  for(const id of ['equipment.softener.D19','equipment.magnetic-holder'])assert.equal(c(id).placedIds.length,0);
  assert.equal(data.catalog.reduce((n,c)=>n+c.unplacedQuantity,0),3);assert.equal(c('equipment.K5').quantity,2);
});
check('Dining chair directions, exact table tops, counter corners and terrace circles',()=>{
  const chairs=data.elements.filter(e=>e.name==='Стул / ТХ'),tables=data.elements.filter(e=>e.name==='Обеденный стол');assert.equal(chairs.length,48);assert.equal(tables.length,11);
  for(const e of chairs){const g=e.geometry,p=g.center,q=tables.map(t=>t.geometry.center).sort((a,b)=>Math.hypot(a[0]-p[0],a[2]-p[2])-Math.hypot(b[0]-p[0],b[2]-p[2]))[0];const dx=q[0]-p[0],dz=q[2]-p[2],a=g.rotation||0;assert((-Math.sin(a)*dx-Math.cos(a)*dz)/Math.hypot(dx,dz)>.2,e.id);}
  for(const e of tables){assert.equal(e.geometry.kind,'footprint_table');assert.equal(e.geometry.footprint.length,4);}
  const circles=data.elements.filter(e=>e.geometry.kind==='round_table');assert.equal(circles.length,6);for(const d of [.4,.6])assert.equal(circles.filter(e=>Math.abs(e.geometry.size[0]-d)<1e-6).length,3);
  assert.equal(data.elements.filter(e=>e.geometry.kind==='armchair').length,12);
  const corners=data.elements.filter(e=>e.geometry.kind==='corner_display');assert.equal(corners.length,2);for(const e of corners){assert.equal(e.geometry.footprint.length,4);assert.deepEqual(data.walk.obstacles.find(o=>o.id===e.id).points,e.geometry.footprint);}
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
for(const variant of ['lstk','km'])check(`${variant}: every room and both terraces reachable; hidden layers retain physical obstacles`,()=>{
  const d={...data,activeVariant:variant};
  for(const s of data.walk.starts)assert(!walkBlocked(s.position[0],s.position[2],d),s.id);
  const hidden={...d,layers:d.layers.map(l=>({...l,defaultVisible:false}))};assert(walkBlocked(3.12,-1,hidden));
  const posts=d.walk.obstacles.filter(o=>o.variant===variant);assert.equal(posts.length,5);for(const o of posts)assert(walkBlocked(o.center[0],o.center[1],hidden));
  const step=.07,x0=-1,z0=-18,nx=187,nz=310;
  const states=new Uint8Array(nx*nz),queue=new Int32Array(nx*nz);let head=0,tail=0;
  const ix=Math.round((7.05-x0)/step),iz=Math.round((1.8-z0)/step),start=iz*nx+ix;
  states[start]=2;queue[tail++]=start;const reached=new Set();
  while(head<tail){
    const cell=queue[head++],x=cell%nx,z=Math.floor(cell/nx),px=x0+x*step,pz=z0+z*step;
    for(const r of data.rooms)if(!reached.has(r.id)&&inPolygon(px,pz,r.points))reached.add(r.id);
    for(const [a,b] of [[x+1,z],[x-1,z],[x,z+1],[x,z-1]]){
      if(a<0||a>=nx||b<0||b>=nz)continue;const next=b*nx+a;if(states[next])continue;
      states[next]=1;if(walkBlocked(x0+a*step,z0+b*step,d))continue;
      states[next]=2;queue[tail++]=next;
    }
  }
  const missing=data.rooms.filter(r=>!reached.has(r.id)).map(r=>r.id);assert.deepEqual(missing,[]);
});

const meshBytes=await fs.readFile(path.join(root,'model/lstk-mesh.bin'));
const asset=meshBytes.buffer.slice(meshBytes.byteOffset,meshBytes.byteOffset+meshBytes.byteLength);
const frame=data.elements.filter(e=>e.geometry.type==='indexedMesh'),positions=new Map();
check('All 453185 factory faces retained with the 1:1 coordinate transform',()=>{
  assert.equal(data.geometryProvenance.sourceFaces,453185);assert.equal(frame.length,3);
  assert.deepEqual(data.geometryProvenance.transform,{scale:.001,translationMm:[-100,-100,0],mapping:'X=x,Y=z,Z=-y'});
  let count=0;const low=[Infinity,Infinity,Infinity],high=low.map(x=>-x);
  for(const e of frame){const g=e.geometry;assert.equal(g.asset,'model/lstk-mesh.bin');assert(g.positionByteOffset+g.vertexCount*12<=asset.byteLength);assert(g.indexByteOffset+g.indexCount*4<=asset.byteLength);
    const p=new Float32Array(asset,g.positionByteOffset,g.vertexCount*3),ix=new Uint32Array(asset,g.indexByteOffset,g.indexCount);positions.set(e.id,p);count+=ix.length/3;for(const id of ix)assert(id<g.vertexCount);
    const lo=[Infinity,Infinity,Infinity],hi=lo.map(x=>-x);for(let i=0;i<p.length;i++){assert(Number.isFinite(p[i]));lo[i%3]=Math.min(lo[i%3],p[i]);hi[i%3]=Math.max(hi[i%3],p[i]);}
    for(let a=0;a<3;a++){assert(Math.abs(lo[a]-g.bounds.min[a])<1e-6);assert(Math.abs(hi[a]-g.bounds.max[a])<1e-6);low[a]=Math.min(low[a],lo[a]);high[a]=Math.max(high[a],hi[a]);}
  }
  assert.equal(count,453185);assert.equal(count,data.geometryProvenance.triangles);
  const r=data.geometryProvenance.rawBounds,lo=[(r.min[0]-100)/1000,r.min[2]/1000,-(r.max[1]-100)/1000],hi=[(r.max[0]-100)/1000,r.max[2]/1000,-(r.min[1]-100)/1000];
  for(let a=0;a<3;a++){assert(Math.abs(low[a]-lo[a])<2e-6);assert(Math.abs(high[a]-hi[a])<2e-6);}
});
check('Primary roof and canopy covers clear the factory support surfaces',()=>{
  const roof=includedElements(data,'lstk').find(e=>e.layer==='ar.roof.core').geometry,canopy=includedElements(data,'lstk').find(e=>e.layer==='ar.canopy').geometry;let nr=0,nc=0;
  for(const p of positions.values())for(let i=0;i<p.length;i+=3){const [x,y,z]=p.subarray(i,i+3);if(x>.2&&x<10.4&&z<-.2&&z>-10.4&&y>3.88){assert(y<=roof.bottom+roof.slope*z-.0035);nr++;}if(x>.2&&x<10.4&&z>.3&&z<2.4){assert(y<=canopy.bottom+canopy.slope*z-.0035);nc++;}}
  assert(nr>1000&&nc>1000);
});
const bytes=await fs.readFile(path.join(root,'assets/cafe.glb'));
assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
check('Exported GLB independently loads with all layers and element IDs',()=>{
  const layerIds=new Set(),ids=new Set();let meshes=0;
  gltf.scene.traverse(o=>{if(o.userData.layerId&&!o.userData.elementId)layerIds.add(o.userData.layerId);if(o.userData.elementId){ids.add(o.userData.elementId);assert.equal(o.userData.variant,data.elements.find(e=>e.id===o.userData.elementId).variant||'common');}if(o.isMesh){meshes++;for(const a of ['position','normal'])for(const n of o.geometry.attributes[a].array)assert(Number.isFinite(n));}});
  assert.equal(layerIds.size,data.layers.length);assert.equal(ids.size,data.elements.length);assert(meshes>data.elements.length);
  const b=new THREE.Box3().setFromObject(gltf.scene);assert(Math.abs(b.max.y-5.05)<1e-5);assert(b.min.z<=-19.99);
});
check('Independent GLB load agrees with binary LSTK positions and triangle counts',()=>{
  for(const e of frame){const o=gltf.scene.getObjectByName(e.id);assert(o);const m=o.children.find(o=>o.isMesh);assert(m);const p=m.geometry.attributes.position.array,src=positions.get(e.id);assert.equal(p.length,src.length);assert.equal(m.geometry.index.count,e.geometry.indexCount);
    const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');assert.equal(hash(p),hash(src));}
});
const stats={result:'PASS',checks:passed,glbBytes:bytes.length,revision:data.revision};
await fs.mkdir(path.join(root,'.work'),{recursive:true});await fs.writeFile(path.join(root,'.work/validation.json'),JSON.stringify(stats,null,2));
console.log(JSON.stringify(stats,null,2));

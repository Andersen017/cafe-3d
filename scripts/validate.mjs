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
// Node verifies the complete GLB structure and PNG headers; actual pixel decoding/rendering is checked in the browser.
globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async blob=>{
  const png=Buffer.from(await blob.arrayBuffer());assert.equal(png.readUInt32BE(0),0x89504e47);
  return {width:png.readUInt32BE(16),height:png.readUInt32BE(20),close(){}};
};
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
check('R04 preserves 1081 unaffected R03 geometries, room layout, TX catalogue and walk obstacles',()=>{
  const changed=new Set(['lstk-walls',...['core','outer','inner'].flatMap(l=>[`ar.walls.${l}-005`,`ar.walls.${l}-005-lstk`]),
    ...['lstk','km'].flatMap(v=>[`finish.r03.${v}.front.panel-5`,`finish.r03.${v}.front.joint-5-2`,...['front','left','right'].map(f=>`finish.r03.${v}.canopy.${f}`)])]);
  assert.equal(changed.size,17);for(const id of changed)assert(data.elements.some(e=>e.id===id));
  const source=data.elements.filter(e=>!changed.has(e.id)&&!/-r04-\d+$/.test(e.id)&&!e.id.startsWith('finish.r04.')&&!['ar.glazing-016','ar.glazing-017'].includes(e.id));
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(source.length,1081);assert.equal(data.elements.length,1130);
  assert.equal(hash(source.map(e=>[e.id,e.layer,e.variant||'common',e.geometry])),'da4019551f048e5305dc87b2216b315c421543856184e27a6e97dd9f271449f6');
  assert.equal(hash([data.catalog,data.rooms]),'287ae3bcdcb27ec07fb140be933eff50d4f1b0f49263ec23355f34d4e4e492b7');
  assert.equal(hash(data.walk),'1c3af0a3de0671b6fc88c064b3a173c6cbb31305f8748e9685a3f01cfd87909b');
});
check('Axis 2 corner is closed in every wall layer and both assemblies; two small windows stay clear',()=>{
  assert(!data.elements.some(e=>e.id==='ar.glazing-011'||e.id==='finish.r03.reveal.ar.glazing-011'));
  assert.equal(data.elements.filter(e=>e.id.startsWith('repair.r03.')).length,6);
  const covers=(e,y,z)=>{const g=e.geometry;return g.type==='box'&&Math.abs(y-g.center[1])<=g.size[1]/2+1e-9&&Math.abs(z-g.center[2])<=g.size[2]/2+1e-9;};
  for(const v of ['lstk','km']){
    const es=includedElements(data,v);
    for(const layer of ['core','outer','inner']){
      const walls=es.filter(e=>e.layer==='ar.walls.'+layer&&e.geometry.center[0]>10.5);
      for(const z of [-.05,-.5,-.909,-1.4,-1.8])for(const y of [.2,.9,1.65,2.15,2.8,3,3.3])assert(walls.some(e=>covers(e,y,z)),`${v} ${layer} ${y} ${z}`);
      for(const id of ['ar.glazing-012','ar.glazing-013']){
        const window=es.find(e=>e.id===id);assert(window);assert(Math.abs(window.geometry.width-.6)<1e-9);assert(Math.abs(window.geometry.height-.55)<1e-9);
        assert(!walls.some(e=>covers(e,window.geometry.center[1],window.geometry.center[2])));
      }
    }
    const panel=es.find(e=>e.id===`finish.r03.${v}.right.corner-wall`);assert.equal(panel.material,'finish_stone');
    assert.deepEqual(panel.geometry.size,[1.818,2.1,.02]);
    assert(walkBlocked(10.6175,-.909,{...data,activeVariant:v}));
  }
});
check('Selected facade design follows both assemblies; signs, displays and reveals are independent layers',()=>{
  for(const id of ['design.exterior','design.signage','design.displays','design.reveals'])assert(data.layers.some(l=>l.id===id&&l.defaultVisible));
  for(const v of ['lstk','km']){
    const es=includedElements(data,v);assert.equal(es.filter(e=>e.layer==='design.signage').length,4);
    assert.equal(es.filter(e=>e.layer==='design.displays').length,2);
    for(const face of ['front','rear','left','right']){
      const belt=es.find(e=>e.id===`finish.r03.${v}.${face}.belt`);assert(belt);assert.equal(belt.geometry.type,'slatPanel');
      assert(Math.abs(belt.geometry.center[1]+belt.geometry.height/2-(v==='lstk'?5.01:4.90))<1e-8);
    }
  }
});
check('Window frames remain recessed; twenty openings in each assembly have reveals and conditional mounting dimensions',()=>{
  const reveals=data.elements.filter(e=>e.geometry.type==='reveal');assert.equal(reveals.length,21);
  for(const v of ['lstk','km'])assert.equal(includedElements(data,v).filter(e=>e.geometry.type==='reveal').length,20);
  for(const e of reveals){const g=e.geometry;assert(g.facadeFace-g.frameFace>.10);assert(g.facadeFace-g.frameFace<.105);
    for(const x of Object.values(g.facadeFaces))assert(x-g.frameFace>=.10&&x-g.frameFace<.115);
    const source=data.elements.find(a=>e.id.endsWith('.reveal.'+a.id));assert(source);assert.deepEqual(g.center,source.geometry.center);
    assert.equal(g.width,source.geometry.width);assert.equal(g.height,source.geometry.height);
  }
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
assert.equal(createHash('sha256').update(meshBytes).digest('hex'),'e4767a9a6fb1d87218501800a5e7e086384c581dca8c5a09dbe6764e0961a81c');
const asset=meshBytes.buffer.slice(meshBytes.byteOffset,meshBytes.byteOffset+meshBytes.byteLength);
const frame=data.elements.filter(e=>e.geometry.type==='indexedMesh'),positions=new Map();
check('Original binary retains all 453185 factory faces and the 1:1 coordinate transform',()=>{
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
const document=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8').trim());
const binaryStart=20+bytes.readUInt32LE(12)+8;
check('Five PNG textures are embedded byte-for-byte in GLB with UVs; no external image dependencies',()=>{
  assert.equal(document.images.length,5);assert.equal(document.textures.length,5);
  for(const image of document.images){assert.equal(image.mimeType,'image/png');assert(!image.uri);const v=document.bufferViews[image.bufferView];
    assert(v.byteOffset+v.byteLength<=document.buffers[0].byteLength);const png=bytes.subarray(binaryStart+v.byteOffset,binaryStart+v.byteOffset+v.byteLength);
    assert.equal(png.readUInt32BE(0),0x89504e47);assert(png.readUInt32BE(16)>0&&png.readUInt32BE(20)>0);
  }
  for(const mesh of document.meshes)for(const p of mesh.primitives){if(document.materials[p.material]?.pbrMetallicRoughness?.baseColorTexture)assert(p.attributes.TEXCOORD_0!==undefined);}
});
for(const image of document.images){const v=document.bufferViews[image.bufferView];const embedded=bytes.subarray(binaryStart+v.byteOffset,binaryStart+v.byteOffset+v.byteLength);
  assert.deepEqual(embedded,await fs.readFile(path.join(root,'assets/textures',image.name)));}
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
check('Exported GLB independently loads with all layers and element IDs',()=>{
  const layerIds=new Set(),ids=new Set();let meshes=0;
  gltf.scene.traverse(o=>{if(o.userData.layerId&&!o.userData.elementId)layerIds.add(o.userData.layerId);if(o.userData.elementId){ids.add(o.userData.elementId);assert.equal(o.userData.variant,data.elements.find(e=>e.id===o.userData.elementId).variant||'common');}if(o.isMesh){meshes++;for(const a of ['position','normal'])for(const n of o.geometry.attributes[a].array)assert(Number.isFinite(n));}});
  assert.equal(layerIds.size,data.layers.length);assert.equal(ids.size,data.elements.length);assert(meshes>data.elements.length);
  const b=new THREE.Box3().setFromObject(gltf.scene);assert(Math.abs(b.max.y-5.05)<1e-5);assert(b.min.z<=-19.99);
});
check('GLB keeps every factory profile and only opens the four designated flat infill triangles',()=>{
  const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
  for(const e of frame){const o=gltf.scene.getObjectByName(e.id);assert(o);const m=o.children.find(o=>o.isMesh);assert(m);const p=m.geometry.attributes.position.array,src=positions.get(e.id),g=e.geometry,ix=m.geometry.index.array;
    const original=new Uint32Array(asset,g.indexByteOffset,g.indexCount);
    assert.equal(hash(p.subarray(0,src.length)),hash(src));
    if(!g.panelOpenings){assert.equal(p.length,src.length);assert.equal(ix.length,original.length);assert.equal(hash(ix),hash(original));continue;}
    assert.equal(e.id,'lstk-walls');assert.deepEqual(g.panelOpenings.flatMap(c=>c.faces),[127666,127667,127668,127669]);
    assert.equal(p.length,src.length+96);assert.equal(ix.length,original.length+36);
    const removed=new Set(g.panelOpenings.flatMap(c=>c.faces));let n=0;
    for(let f=0;f<original.length/3;f++)if(!removed.has(f))for(let k=0;k<3;k++)assert.equal(ix[n++],original[f*3+k]);
    let area=0;const [a,b,c,d]=g.panelOpenings[0].opening;
    for(let k=n;k<ix.length;k+=3){const ps=[0,1,2].map(t=>Array.from(p.subarray(ix[k+t]*3,ix[k+t]*3+3)));for(const pt of ps)assert([0,.1].some(z=>Math.abs(pt[2]-z)<1e-7));
      const minX=Math.min(...ps.map(t=>t[0])),maxX=Math.max(...ps.map(t=>t[0])),minY=Math.min(...ps.map(t=>t[1])),maxY=Math.max(...ps.map(t=>t[1]));
      assert(maxX<=a+1e-6||minX>=c-1e-6||maxY<=b+1e-6||minY>=d-1e-6,'infill crosses the new window');
      area+=Math.abs((ps[1][0]-ps[0][0])*(ps[2][1]-ps[0][1])-(ps[1][1]-ps[0][1])*(ps[2][0]-ps[0][0]))/2;
    }
    assert(Math.abs(area-2*((6.165-3.185)*3.88-.6*.55))<1e-5);
  }
});
check('New window has frame top +2.150 and glass top +2.100, coordinated with the selected assembly',()=>{
  for(const v of ['km','lstk']){
    const es=includedElements(data,v);
    const e=es.find(e=>['ar.glazing-016','ar.glazing-017'].includes(e.id));assert(e);const g=e.geometry;assert.equal(g.frameWidth,.05);assert.equal(e.variant,v);
    assert.equal(g.center[0],v==='lstk'?5.255:5.4);
    let o;gltf.scene.traverse(a=>{if(a.userData.elementId===e.id)o=a;});assert(o);
    const glass=o.children.find(o=>o.isMesh&&o.material.name==='glass');assert(glass);
    const glassBounds=new THREE.Box3().setFromObject(glass),bounds=new THREE.Box3().setFromObject(o);
    assert(Math.abs(bounds.max.y-2.15)<1e-6);assert(Math.abs(bounds.min.y-1.6)<1e-6);assert(Math.abs(glassBounds.max.y-2.1)<1e-6);
    for(const layer of ['ar.walls.core','ar.walls.outer','ar.walls.inner','design.exterior']){
      for(const x of [g.center[0]-.25,g.center[0],g.center[0]+.25])for(const y of [1.651,1.875,2.099]){
        assert(!es.some(e=>{const a=e.geometry;if(e.layer!==layer||a.type!=='box'||(a.rotation||0)!==0||Math.abs(a.center[2])>.2)return false;
          return Math.abs(x-a.center[0])<a.size[0]/2-1e-6&&Math.abs(y-a.center[1])<a.size[1]/2-1e-6;}),`${v} ${layer} fills the opening`);
      }
    }
  }
});
check('Existing LSTK profiles and KM braces do not cross the relocated glazing',()=>{
  const ray=new THREE.Raycaster();ray.near=0;ray.far=.35;
  for(const v of ['lstk','km']){
    const es=includedElements(data,v),window=es.find(e=>['ar.glazing-016','ar.glazing-017'].includes(e.id));
    const frameIds=new Set(es.filter(e=>v==='lstk'?e.id==='lstk-walls':e.layer==='km.reference').map(e=>e.id));
    const frame=[];gltf.scene.traverse(o=>{if(frameIds.has(o.userData.elementId))frame.push(o);});assert(frame.length);
    for(const x of [-.24,0,.24])for(const y of [1.66,1.875,2.09]){
      ray.set(new THREE.Vector3(window.geometry.center[0]+x,y,.2),new THREE.Vector3(0,0,-1));
      assert.equal(ray.intersectObjects(frame,true).length,0,`${v}: structural element crosses clear glazing at ${x},${y}`);
    }
  }
});
check('Canopy fascia closes above structural edges, caps are continuous and source roof geometry is preserved',()=>{
  for(const v of ['km','lstk']){
    const top=v==='lstk'?3.97:3.82;
    for(const face of ['front','left','right']){const g=data.elements.find(e=>e.id===`finish.r03.${v}.canopy.${face}`).geometry;
      assert.equal(g.slope,0);assert(Math.abs(g.center[1]+g.height/2-top)<1e-8);assert(Math.abs(g.center[1]-g.height/2-3.3)<1e-8);}
    const cap=data.elements.find(e=>e.id===`finish.r04.${v}.canopy.cap`).geometry;assert.equal(cap.points.length,8);assert.equal(cap.bottom,top);
  }
  const frameTop=data.elements.find(e=>e.id==='lstk-canopy').geometry.bounds.max[1];assert(3.97-frameTop>.019);
});
const stats={result:'PASS',checks:passed,glbBytes:bytes.length,revision:data.revision};
await fs.mkdir(path.join(root,'.work'),{recursive:true});await fs.writeFile(path.join(root,'.work/validation.json'),JSON.stringify(stats,null,2));
console.log(JSON.stringify(stats,null,2));

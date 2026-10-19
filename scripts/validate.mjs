import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {walkBlocked,groundAt,moveWalker,inPolygon} from './walk.mjs';
import {includedElements,variantById} from './variants.mjs';
import {carPose,createSceneryMotion,pedestrianPose} from './scenery-motion.mjs';
import {createDesignController,designById} from './designs.mjs';
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
check('R08 preserves all 1177 cafe elements from R07, room layout, TX catalogue and walk obstacles',()=>{
  const source=data.elements.filter(e=>!e.id.startsWith('r08.')&&!e.id.startsWith('r10.')&&e.id!=='env.site-001');
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(source.length,1177);assert.equal(data.elements.length,1186);
  assert.equal(hash(source.map(e=>[e.id,e.layer,e.variant||'common',e.geometry])),'6ace522dbc31dfc3a420e6616a7ec4a20dd7ab17c44a715844f30a7740b4c795');
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
const frame=data.elements.filter(e=>e.geometry.type==='indexedMesh'&&e.layer.startsWith('lstk.')),positions=new Map();
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
check('Six PNG textures are embedded byte-for-byte in GLB with UVs; no external image dependencies',()=>{
  assert.equal(document.images.length,6);assert.equal(document.textures.length,6);
  for(const image of document.images){assert.equal(image.mimeType,'image/png');assert(!image.uri);const v=document.bufferViews[image.bufferView];
    assert(v.byteOffset+v.byteLength<=document.buffers[0].byteLength);const png=bytes.subarray(binaryStart+v.byteOffset,binaryStart+v.byteOffset+v.byteLength);
    assert.equal(png.readUInt32BE(0),0x89504e47);assert(png.readUInt32BE(16)>0&&png.readUInt32BE(20)>0);
  }
  for(const mesh of document.meshes)for(const p of mesh.primitives){if(document.materials[p.material]?.pbrMetallicRoughness?.baseColorTexture)assert(p.attributes.TEXCOORD_0!==undefined);}
});
for(const image of document.images){const v=document.bufferViews[image.bufferView];const embedded=bytes.subarray(binaryStart+v.byteOffset,binaryStart+v.byteOffset+v.byteLength);
  assert.deepEqual(embedded,await fs.readFile(path.join(root,'assets/textures',image.name)));}
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const designs=await createDesignController(gltf,data.designs);
check('Graphite is design 1 and the fallback; the unchanged light finish is design 2',()=>{
  assert.equal(data.designs.default,'graphite');assert.equal(designById(data.designs,'invalid').id,'graphite');
  assert.deepEqual(data.designs.options.map(v=>[v.id,v.number]),[['graphite',1],['light',2]]);
  assert(document.extensionsUsed.includes('KHR_materials_variants'));
  const ext=document.extensions.KHR_materials_variants;
  assert.deepEqual(ext.variants.map(v=>v.extras.id),['graphite','light']);
  const srgb=new THREE.Color('#474b52').toArray();
  for(const mesh of document.meshes)for(const primitive of mesh.primitives){
    const pbr=document.materials[primitive.material];
    if(pbr.name==='finish_stone'){
      assert.deepEqual(pbr.pbrMetallicRoughness.baseColorFactor,[...srgb,1]);assert(!pbr.pbrMetallicRoughness.baseColorTexture);
    }
  }
  assert(designs.surfaceCount>100);
});
check('Design switching preserves geometry, transforms, visibility and exact original light materials',()=>{
  const entries=[];
  gltf.scene.traverse(o=>{entries.push([o,o.geometry,o.matrix.toArray(),o.visible]);});
  const signature=()=>entries.map(([o])=>[o.uuid,o.geometry?.uuid,o.matrix.toArray(),o.visible]);
  const before=signature();
  designs.set('light');assert.equal(designs.active,'light');
  let wood=0,stone=0;
  gltf.scene.traverse(o=>{
    if(!o.isMesh)return;
    const ref=gltf.parser.associations.get(o),p=document.meshes[ref?.meshes]?.primitives[ref?.primitives];
    const mapping=p?.extensions?.KHR_materials_variants?.mappings;
    if(!mapping)return;
    const definition=document.materials[mapping.find(m=>m.variants.includes(1)).material];
    const base=definition.name.replace(/__light$/,'');
    assert.deepEqual(o.material.color.toArray(),new THREE.Color(data.materials[base].color).toArray());
    if(base==='finish_wood'){assert(o.material.map);assert(o.material.vertexColors);wood++;}
    if(base==='finish_stone'){assert(o.material.map);stone++;}
  });
  assert(wood>10&&stone>50);
  const lightMaterials=entries.map(([o])=>o.material);
  designs.set('graphite');assert.equal(designs.active,'graphite');
  gltf.scene.traverse(o=>{if(o.isMesh&&o.material.name==='finish_stone')assert(!o.material.map);});
  assert.deepEqual(signature(),before);
  designs.set('light');assert.deepEqual(entries.map(([o])=>o.material),lightMaterials);
  designs.set('graphite');
});
check('Exported GLB independently loads with all layers and element IDs',()=>{
  const layerIds=new Set(),ids=new Set();let meshes=0;
  gltf.scene.traverse(o=>{if(o.userData.layerId&&!o.userData.elementId)layerIds.add(o.userData.layerId);if(o.userData.elementId){ids.add(o.userData.elementId);assert.equal(o.userData.variant,data.elements.find(e=>e.id===o.userData.elementId).variant||'common');}if(o.isMesh){meshes++;for(const a of ['position','normal'])for(const n of o.geometry.attributes[a].array)assert(Number.isFinite(n));}});
  assert.equal(layerIds.size,data.layers.length);assert.equal(ids.size,data.elements.length);assert(meshes>data.elements.length);
  const cafe=new THREE.Box3();gltf.scene.traverse(o=>{if(o.userData.elementId&&!o.userData.layerId.startsWith('env.'))cafe.expandByObject(o);});assert(Math.abs(cafe.max.y-5.05)<1e-5);assert(cafe.min.z<-16.6);
  const b=new THREE.Box3().setFromObject(gltf.scene);assert(b.max.y>=16.3-1e-5&&b.max.y<19);assert(b.min.z<-55.5);assert.equal(b.min.x,-24);assert.equal(b.max.x,104);
});
check('Four blueprint context layers are common to both variants and retain original CMM placement',()=>{
  assert.equal(data.context.placement,'original-cmm-axes');assert.deepEqual(data.context.cmmToModel,{x:'u',zOffset:2.45,zSign:-1});
  assert.equal(data.context.sourceGeometryHash,'772a8a320efa875cc2f00716dc1fd47904e01a538bf1f47ba3aebe6792a11198');
  for(const id of ['env.buildings','env.paving','env.fences','env.green']){
    const l=data.layers.find(l=>l.id===id);assert(l.defaultVisible);assert(!l.variant);
    for(const v of ['lstk','km'])assert.equal(includedElements(data,v).filter(e=>e.layer===id).length,1);
  }
  const buildings=data.elements.find(e=>e.layer==='env.buildings').geometry.buildings;assert.equal(buildings.length,1);assert.equal(buildings[0].floorCount,5);assert.equal(buildings[0].height,16.5);assert.equal(buildings[0].sourceHandle,'1A73');
  const x=Math.min(...buildings[0].points.map(p=>p[0]));assert(Math.abs(x-27.3334)<1e-4);
  assert(!data.context.elevationsAreSurveyed);assert(!data.context.treesAreInventory);assert.equal(data.context.excludedExistingCheckpoint,'1E1E');
});
const contextStats={meshes:0,lines:0,triangles:0,segments:0,geometryBytes:0,glbIncreaseBytes:bytes.length-25760552};
check('Blueprint context stays within the 2 MB budget without textures, lights or shadow passes',()=>{
  assert(contextStats.glbIncreaseBytes>0&&contextStats.glbIncreaseBytes<=data.context.geometryBudgetBytes);
  gltf.scene.traverse(o=>{if(!o.userData.context)return;assert(!o.isLight);if(!o.geometry)return;
    assert(!o.material.map&&!o.material.normalMap&&!o.material.roughnessMap);assert(!o.castShadow);
    const g=o.geometry;contextStats.geometryBytes+=Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?.array.byteLength||0);
    if(o.isLine){contextStats.lines++;contextStats.segments+=(g.index?.count||g.attributes.position.count)/2;}
    else if(o.isMesh){contextStats.meshes++;contextStats.triangles+=(g.index?.count||g.attributes.position.count)/3;}
  });
  assert(contextStats.lines>=4&&contextStats.lines<=36);assert(contextStats.meshes<=8);assert(contextStats.geometryBytes<2000000);assert(contextStats.triangles<15000);assert(contextStats.segments<10000);
});
check('Scenery layers stay common to both variants, with unchanged cafe layer composition',()=>{
  for(const id of ['env.sky','env.people','env.traffic']){
    const layer=data.layers.find(l=>l.id===id);assert(layer?.defaultVisible);assert(!layer.variant);
    for(const e of data.elements.filter(e=>e.layer===id)){assert.equal(e.status,'schematic');assert(!e.variant);}
  }
  const original=data.elements.filter(e=>!e.id.startsWith('r10.'));
  assert.equal(original.length,1182);assert.equal(data.layers.length,41);
  const sky=data.elements.find(e=>e.layer==='env.sky').geometry;assert.equal(sky.clouds.length,3);
  assert.equal(data.elements.filter(e=>e.geometry.motion?.kind==='car').length,1);
  const celestial=[];gltf.scene.traverse(o=>{if(o.userData.skyMode)celestial.push(o.userData.skyMode);});assert.deepEqual(celestial.sort(),['day','evening']);
});
const occupants=data.elements.find(e=>e.id==='r10.context.people').geometry;
check('R12 removes near crowns and seats six terrace guests, four indoor guests and a guard on existing chairs',()=>{
  assert.equal(occupants.type,'contextOccupants');assert.equal(occupants.staticPeople.length,13);assert.equal(occupants.visitors.length,3);
  const seated=occupants.staticPeople.filter(p=>p.pose==='seated');assert.equal(seated.length,11);assert.equal(new Set(seated.map(p=>p.chairId)).size,11);
  for(const [room,n] of [['terrace',6],['hall',4]])assert.equal(seated.filter(p=>p.room===room&&p.role==='guest').length,n);
  assert.equal(seated.filter(p=>p.role==='guard'&&p.room==='security').length,1);
  const guard=seated.find(p=>p.role==='guard');for(const e of data.elements.filter(e=>e.layer==='tx.security'&&e.geometry.kind==='footprint_table'))assert(!inPolygon(guard.center[0],guard.center[2],e.geometry.footprint),'guard torso inside desk');
  for(const p of seated){
    const chair=data.elements.find(e=>e.id===p.chairId);assert(chair);assert(['chair','armchair'].includes(chair.geometry.kind));
    assert.equal(p.center[0],chair.geometry.center[0]);assert.equal(p.center[2],chair.geometry.center[2]);assert.equal(p.rotation,chair.geometry.rotation||0);
  }
  for(const p of occupants.staticPeople.filter(p=>p.pose==='standing'))for(const variant of ['lstk','km'])assert(!walkBlocked(p.center[0],p.center[2],{...data,activeVariant:variant},.28),p.id);
  const trees=data.elements.find(e=>e.layer==='env.green').geometry.trees;assert.equal(trees.length,7);
  for(const t of trees){const [x,z]=t.center;assert(Math.hypot(Math.max(-.2-x,0,x-10.8),Math.max(-16.85-z,0,z-2.6))>=8);}
  assert(trees.some(t=>t.sourceHandle==='1ECE')&&trees.some(t=>t.sourceHandle==='1ED5'));
});
check('Three staggered pedestrian routes cross the actual doors, clear walls and furniture in both variants, and never meet',()=>{
  assert.deepEqual(occupants.visitors.map(r=>r.door).sort(),['ar.doors-003','ar.doors-004','ar.doors-005']);
  assert.equal(new Set(occupants.visitors.map(r=>r.start)).size,3);assert.equal(new Set(occupants.visitors.map(r=>r.wait)).size,3);
  for(const r of occupants.visitors){
    assert.deepEqual(gltf.scene.getObjectByName('visitor-'+r.id).userData.contextMotion,r);
    const door=data.elements.find(e=>e.id===r.door).geometry;let closest=Infinity;
    for(let t=0;t<=r.period;t+=.1){
      const p=pedestrianPose(t,r);closest=Math.min(closest,Math.hypot(p.x-door.center[0],p.z-door.center[2]));
      for(const v of ['lstk','km'])assert(!walkBlocked(p.x,p.z,{...data,activeVariant:v},r.radius),`${r.id} ${v} ${t}`);
      const floor=groundAt(p.x,p.z,data);assert(floor!==null&&p.y>=floor-.0001&&p.y<=floor+.151);
      const next=pedestrianPose(t+.01,r);assert(Math.hypot(next.x-p.x,next.z-p.z)<=r.speed*.0101);assert(Math.cos(next.yaw-p.yaw)>.995);
    }
    assert(closest<.04,r.id+' does not cross its door');
    const a=pedestrianPose(0,r),b=pedestrianPose(r.period-.00001,r);assert(Math.hypot(a.x-b.x,a.z-b.z)<1e-5);assert(Math.cos(a.yaw-b.yaw)>.999);
  }
  let overlap=0;
  for(let t=0;t<occupants.visitors[0].period;t+=.1){
    const poses=occupants.visitors.map(r=>pedestrianPose(t,r));
    if(poses.filter(p=>p.moving).length===3)overlap++;
    for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)assert(Math.hypot(poses[i].x-poses[j].x,poses[i].z-poses[j].z)>.6);
  }assert.equal(overlap,0,'all visitors move as one group');
});
check('Walking visitor limbs animate, pause and resume while seated guests stay static',()=>{
  const group=gltf.scene.getObjectByName('visitor-left');assert(group);
  const motion=createSceneryMotion(gltf.scene),still=gltf.scene.getObjectByName('seated-guests-and-staff');assert(still);
  const positions=Array.from(still.geometry.attributes.position.array);
  for(let i=0;i<140;i++)motion.update(.05,true);
  const p=group.position.clone(),q=group.quaternion.clone();let changedLimb=false;
  group.traverse(o=>{if(o.userData.pedestrianLimb&&Math.abs(o.rotation.x)>.01)changedLimb=true;});assert(changedLimb);
  motion.update(.05,false);assert(group.position.equals(p)&&group.quaternion.equals(q));
  const layer=gltf.scene.children.find(o=>o.userData.layerId==='env.people')||group.parent.parent;layer.visible=false;motion.update(.05,true);assert(group.position.equals(p));layer.visible=true;
  motion.update(.05,true);assert(group.position.distanceTo(p)>.01);
  assert.deepEqual(Array.from(still.geometry.attributes.position.array),positions);
});
check('Visitor speed follows elapsed seconds even when frame callbacks are infrequent',()=>{
  const make=()=>{const root=new THREE.Group(),person=new THREE.Group();root.add(person);person.userData.contextMotion=occupants.visitors[0];return {person,motion:createSceneryMotion(root)};};
  const fast=make(),slow=make();for(let i=0;i<140;i++)fast.motion.update(.05,true);for(let i=0;i<7;i++)slow.motion.update(1,true);
  assert(fast.person.position.distanceTo(slow.person.position)<1e-7);assert(Math.abs(fast.person.quaternion.dot(slow.person.quaternion))>.999999);
});
check('Animated car remains on CMM road surfaces and has a continuous closed route',()=>{
  const car=data.elements.find(e=>e.id==='r10.context.car'),m=car.geometry.motion;
  const road=data.elements.find(e=>e.layer==='env.paving').geometry.surfaces.filter(p=>p.kind==='road');
  const onRoad=p=>road.some(r=>inPolygon(...p,r.points)&&!(r.holes||[]).some(h=>inPolygon(...p,h)));
  const total=2*(m.zMax-m.zMin)+2*Math.PI*m.radius;
  for(let i=0;i<400;i++){
    const p=carPose(total*i/400,m),c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    for(const x of [-.95,.95])for(const z of [-2.2,2.2])assert(onRoad([p.x+x*c+z*s,p.z-x*s+z*c]),`road at ${i}`);
  }
  const a=carPose(0,m),b=carPose(total,m);assert(Math.hypot(a.x-b.x,a.z-b.z)<1e-8);
  for(const d of [m.zMax-m.zMin,m.zMax-m.zMin+Math.PI*m.radius,total-Math.PI*m.radius]){
    const a=carPose(d-1e-5,m),b=carPose(d+1e-5,m);assert(Math.hypot(a.x-b.x,a.z-b.z)<.0001);assert(Math.cos(a.yaw-b.yaw)>.99999);
  }
});
check('Scenery motion freezes on pause and hidden layers and resumes without resetting',()=>{
  const root=new THREE.Group(),layer=new THREE.Group(),car=new THREE.Group();root.add(layer);layer.add(car);
  car.userData.contextMotion=data.elements.find(e=>e.id==='r10.context.car').geometry.motion;
  const motion=createSceneryMotion(root);assert.equal(motion.count,1);
  const a=car.position.clone();motion.update(.05,true);assert(car.position.distanceTo(a)>.09);
  const b=car.position.clone();motion.update(.05,false);assert(car.position.equals(b));
  layer.visible=false;motion.update(.05,true);assert(car.position.equals(b));
  layer.visible=true;motion.update(.05,true);assert(car.position.distanceTo(b)>.09&&car.position.distanceTo(b)<.11);
});
check('Source context paving does not fill or cover the existing cafe platforms',()=>{
  let paving;gltf.scene.traverse(o=>{if(o.userData.elementId==='r08.context.paving')paving=o;});assert(paving);
  const ray=new THREE.Raycaster();ray.far=4;
  for(const [x,z] of [[5.3,-5.3],[5.3,1],[5.3,-13]]){ray.set(new THREE.Vector3(x,2,z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(paving,true).filter(h=>h.object.isMesh);assert.equal(hits.length,0,`${x},${z}`);}
});
check('Source profiles stay byte-identical; separated infill and frame form a lossless partition',()=>{
  const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
  for(const e of frame){const o=gltf.scene.getObjectByName(e.id);assert(o);const m=o.children.find(o=>o.isMesh);assert(m);const p=m.geometry.attributes.position.array,src=positions.get(e.id),g=e.geometry,ix=m.geometry.index.array;
    const original=new Uint32Array(asset,g.indexByteOffset,g.indexCount);
    assert.equal(hash(p),hash(src));
    if(!g.faceSelection){assert.equal(hash(ix),hash(original));continue;}
    assert.equal(g.faceSelection.mode,'exclude');assert(!g.panelOpenings);
    const fill=data.elements.find(a=>a.id===(e.id==='lstk-canopy'?'r07':'r06')+'.infill.'+e.id);assert(fill);assert.equal(fill.layer,'ar.lstk.infill');assert.deepEqual(fill.geometry.faceSelection,{...g.faceSelection,mode:'include'});
    const ids=g.faceSelection.ranges.flatMap(([a,b])=>Array.from({length:b-a+1},(_,i)=>a+i));
    const expected={
      'lstk-walls':[289,'050584a15712cd31a55f5c2ffea2db34c3fc204647fe12a19651b40b59110677'],
      'lstk-roof':[48,'93166ca3d53e9ce57ba0ef57a94612246c5e5014666933f6f000b58d3d121f45'],
      'lstk-canopy':[140,'277f3f12587b3915e041f56207dd9714941a9edd7af515d949e2422494913a92']
    }[e.id];
    assert.equal(ids.length,expected[0]);assert.equal(hash(new Uint32Array(ids)),expected[1]);assert.equal(new Set(ids).size,ids.length);
    const removed=new Set(ids);let n=0;
    for(let f=0;f<original.length/3;f++)if(!removed.has(f))for(let k=0;k<3;k++)assert.equal(ix[n++],original[f*3+k]);
    assert.equal(n,ix.length);assert.equal(ix.length+ids.length*3,original.length);
    let fillObject;gltf.scene.traverse(o=>{if(o.userData.elementId===fill.id)fillObject=o;});assert(fillObject);
    const fm=fillObject.children.find(o=>o.isMesh),fp=fm.geometry.attributes.position.array,fi=fm.geometry.index.array;
    const opened=new Set((fill.geometry.panelOpenings||[]).flatMap(c=>c.faces));n=0;
    for(const f of ids)if(!opened.has(f))for(let k=0;k<3;k++){const dest=fi[n++]*3,source=original[f*3+k]*3;for(let a=0;a<3;a++)assert.equal(fp[dest+a],src[source+a]);}
    if(!opened.size){assert.equal(n,fi.length);continue;}
    assert.deepEqual([...opened],[127666,127667,127668,127669]);
    assert.equal(fi.length,(ids.length-4)*3+48);
    let area=0;const [a,b,c,d]=fill.geometry.panelOpenings[0].opening;
    for(let k=n;k<fi.length;k+=3){const ps=[0,1,2].map(t=>Array.from(fp.subarray(fi[k+t]*3,fi[k+t]*3+3)));for(const pt of ps)assert([0,.1].some(z=>Math.abs(pt[2]-z)<1e-7));
      const minX=Math.min(...ps.map(t=>t[0])),maxX=Math.max(...ps.map(t=>t[0])),minY=Math.min(...ps.map(t=>t[1])),maxY=Math.max(...ps.map(t=>t[1]));
      assert(maxX<=a+1e-6||minX>=c-1e-6||maxY<=b+1e-6||minY>=d-1e-6,'infill crosses the new window');
      area+=Math.abs((ps[1][0]-ps[0][0])*(ps[2][1]-ps[0][1])-(ps[1][1]-ps[0][1])*(ps[2][0]-ps[0][0]))/2;
    }
    assert(Math.abs(area-2*((6.165-3.185)*3.88-.6*.55))<1e-5);
  }
  const layer=data.layers.find(l=>l.id==='ar.lstk.infill');assert(layer.defaultVisible);assert.equal(layer.variant,'lstk');assert(!variantById(data,'lstk').frameLayers.includes(layer.id));
});
check('All five canopy posts and both end trusses retain profiles without their solid envelopes',()=>{
  const e=frame.find(e=>e.id==='lstk-canopy'),g=e.geometry,p=positions.get(e.id),ix=new Uint32Array(asset,g.indexByteOffset,g.indexCount);
  const blocks=[...Array.from({length:9},(_,i)=>[108864+i*12,12]),[109644,12]];
  const centers=new Set();
  for(const [start,count] of blocks){
    const points=[];for(let f=start;f<start+count;f++)for(let k=0;k<3;k++)points.push(Array.from(p.subarray(ix[f*3+k]*3,ix[f*3+k]*3+3)));
    const unique=new Set(points.map(a=>a.join(',')));assert.equal(unique.size,8,'must be a plain solid envelope, not a perforated profile');
    const low=[0,1,2].map(a=>Math.min(...points.map(p=>p[a]))),high=[0,1,2].map(a=>Math.max(...points.map(p=>p[a])));
    assert(Math.abs(low[1])<1e-6);assert(Math.abs(high[1]-3.49)<1e-6);assert(Math.abs(high[2]-low[2]-.1)<1e-6);
    assert([.2,.4].some(w=>Math.abs(high[0]-low[0]-w)<1e-6));centers.add(((low[0]+high[0])/2).toFixed(2));
  }
  assert.deepEqual([...centers].sort(),['0.10','10.50','2.65','5.30','7.95']);
  for(const [a,b] of [[108844,108853],[108854,108863]]){
    const points=[];for(let f=a;f<=b;f++)for(let k=0;k<3;k++)points.push(Array.from(p.subarray(ix[f*3+k]*3,ix[f*3+k]*3+3)));
    assert.equal(new Set(points.map(a=>a.join(','))).size,8);assert(Math.abs(Math.max(...points.map(p=>p[1]))-3.95)<1e-6);
  }
});
check('Bare LSTK walls are open between studs; toggled infill closes the same locations',()=>{
  const wall=gltf.scene.getObjectByName('lstk-walls'),fill=[];gltf.scene.traverse(o=>{if(o.userData.elementId==='r06.infill.lstk-walls')fill.push(o);});assert(fill.length);
  const ray=new THREE.Raycaster();ray.far=.5;
  for(const x of [3.5,4.1,4.7,5.3]){
    ray.set(new THREE.Vector3(x,.8,.25),new THREE.Vector3(0,0,-1));
    assert.equal(ray.intersectObject(wall,true).length,0,`wall infill remains at ${x}`);assert(ray.intersectObjects(fill,true).length>0,`missing separated infill at ${x}`);
  }
});
check('New window has frame top +2.150 and glass top +2.100, coordinated with the selected assembly',()=>{
  for(const v of ['km','lstk']){
    const es=includedElements(data,v);
    const e=es.find(e=>['ar.glazing-016','ar.glazing-017'].includes(e.id));assert(e);const g=e.geometry;assert.equal(g.frameWidth,.05);assert.equal(e.variant,v);
    assert.equal(g.center[0],4.7);
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
check('Architectural window stays fixed; temporary display clears it while original structural clashes remain reviewable',()=>{
  const ray=new THREE.Raycaster();ray.near=0;ray.far=.35;
  for(const v of ['lstk','km']){
    const es=includedElements(data,v),window=es.find(e=>['ar.glazing-016','ar.glazing-017'].includes(e.id));
    const replacements=es.filter(e=>e.replaces),replaced=new Set(replacements.map(e=>e.replaces));assert(replacements.length);
    const frameIds=new Set(es.filter(e=>(v==='lstk'?e.id==='lstk-walls':e.layer==='km.reference')&&!replaced.has(e.id)||e.layer==='coordination.window').map(e=>e.id));
    const frame=[],original=[];gltf.scene.traverse(o=>{if(frameIds.has(o.userData.elementId))frame.push(o);if(replaced.has(o.userData.elementId))original.push(o);});assert(frame.length);assert(original.length);
    let originalHits=0;
    for(const x of [-.249,-.12,0,.12,.249])for(const y of [1.66,1.875,2.09]){
      ray.set(new THREE.Vector3(window.geometry.center[0]+x,y,.2),new THREE.Vector3(0,0,-1));
      assert.equal(ray.intersectObjects(frame,true).length,0,`${v}: provisional display crosses glazing at ${x},${y}`);
      originalHits+=ray.intersectObjects(original,true).length;
    }
    assert(originalHits>0,`${v}: original intersections must remain available`);
    for(const e of replacements){assert.equal(e.status,'schematic');assert(e.geometry.visualOpening);assert(data.elements.some(s=>s.id===e.replaces));}
  }
});
check('Sixteen portable up/down luminaires have thirty-two correctly directed warm spot lights',()=>{
  const lights=data.elements.filter(e=>e.geometry.type==='upDownLight');assert.equal(lights.length,16);assert.equal(data.parameters.exteriorLighting.kelvin,3000);
  for(const face of ['front','rear','left','right'])assert(lights.some(e=>e.id.startsWith('r05.light.'+face+'.')));
  for(const e of lights){let o;gltf.scene.traverse(a=>{if(a.userData.elementId===e.id)o=a;});assert(o);const spots=[];o.traverse(a=>{if(a.isSpotLight)spots.push(a);});assert.equal(spots.length,2);
    const signs=spots.map(s=>{const p=new THREE.Vector3(),q=new THREE.Vector3();s.getWorldPosition(p);s.target.getWorldPosition(q);const dir=q.sub(p).normalize();assert(Math.abs(dir.y)>.98);assert(s.color.r>s.color.b);return Math.sign(dir.y);});assert(signs.includes(-1)&&signs.includes(1));
    for(const v of ['lstk','km']){
      const face=e.id.split('.')[2],side=['front','rear'].includes(face)?0:2,pos=e.geometry.center[side];
      assert(includedElements(data,v).some(w=>w.layer==='ar.walls.outer'&&w.name.endsWith('/ '+face)&&Math.abs(w.geometry.center[side]-pos)<w.geometry.size[side]/2+.001&&Math.abs(w.geometry.center[1]-2.6)<w.geometry.size[1]/2+.001),'fixture has no solid wall backing');
    }
  }
});
check('Continuous soffit covers the full entrance canopy with independent layer control',()=>{
  assert(data.layers.some(l=>l.id==='design.soffit'&&l.defaultVisible));assert(data.layers.some(l=>l.id==='em.lighting'&&l.defaultVisible));assert(data.layers.some(l=>l.id==='coordination.window'&&l.defaultVisible));
  for(const v of ['lstk','km']){const e=data.elements.find(e=>e.id===`r05.${v}.soffit`);assert(e);assert.equal(e.variant,v);assert.deepEqual(e.geometry.size,[10.8,.025,2.45]);assert(Math.abs(e.geometry.center[1]-.025/2-3.3)<1e-8);}
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
const stats={result:'PASS',checks:passed,glbBytes:bytes.length,revision:data.revision,context:contextStats};
await fs.mkdir(path.join(root,'.work'),{recursive:true});await fs.writeFile(path.join(root,'.work/validation.json'),JSON.stringify(stats,null,2));
console.log(JSON.stringify(stats,null,2));

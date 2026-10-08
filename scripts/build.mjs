import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {buildModel,modelBounds} from './scene.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=JSON.parse(await fs.readFile(path.join(root,'model/canonical.json'),'utf8'));
if(!globalThis.FileReader)globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();}).catch(e=>this.onerror?.(e));}
  readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result='data:'+blob.type+';base64,'+Buffer.from(v).toString('base64');this.onloadend?.();}).catch(e=>this.onerror?.(e));}
};
const {root:scene}=buildModel(data);
const glb=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:false,trs:true});
await fs.mkdir(path.join(root,'assets'),{recursive:true});
await fs.writeFile(path.join(root,'assets/cafe.glb'),Buffer.from(glb));

// Keep the browser runtime local. Copy only the actual loader dependency graph.
const vendorRoot=path.join(root,'vendor');
const threeRoot=path.join(root,'node_modules/three');
const seen=new Set();
async function copy(rel){
  if(seen.has(rel))return;seen.add(rel);
  const raw=await fs.readFile(path.join(threeRoot,rel),'utf8');
  const dest=path.join(vendorRoot,rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,raw);
  for(const match of raw.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){
    const next=path.posix.normalize(path.posix.join(path.posix.dirname(rel),match[1]));
    if(next.endsWith('.js'))await copy(next);
  }
}
await copy('build/three.module.js');await copy('examples/jsm/loaders/GLTFLoader.js');await copy('examples/jsm/controls/OrbitControls.js');
await fs.copyFile(path.join(threeRoot,'LICENSE'),path.join(vendorRoot,'THREE-LICENSE.txt'));
await fs.writeFile(path.join(root,'.nojekyll'),'');
const stats={revision:data.revision,date:data.date,elements:data.elements.length,layers:data.layers.length,
  rooms:data.rooms.length,glbBytes:glb.byteLength,bounds:modelBounds(scene),runtime:'three 0.180.0'};
await fs.writeFile(path.join(root,'assets/model-info.json'),JSON.stringify(stats,null,2));
console.log(JSON.stringify(stats,null,2));

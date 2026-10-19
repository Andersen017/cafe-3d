// Embed the tracked PNG artwork in GLB using standard glTF buffer views.
// This keeps the build independent from native rasterizers and makes the downloaded GLB self-contained.
import fs from 'node:fs/promises';
import path from 'node:path';
import {Color} from 'three';
export async function embedTextures(glb,data,root){
 const source=Buffer.from(glb),jsonLength=source.readUInt32LE(12);
 const doc=JSON.parse(source.subarray(20,20+jsonLength).toString('utf8').trim());
 const binaryOffset=20+jsonLength;
 let binary=source.subarray(binaryOffset+8,binaryOffset+8+source.readUInt32LE(binaryOffset));
 doc.images??=[];doc.textures??=[];doc.samplers??=[];
 const sampler=doc.samplers.push({magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497})-1;
 const textures=new Map();
 async function texture(relative){
  let index=textures.get(relative);
  if(index===undefined){
   if(!/^assets\/textures\/[\w-]+\.png$/.test(relative))throw Error('Invalid texture asset: '+relative);
   const png=await fs.readFile(path.join(root,relative));
   if(png.readUInt32BE(0)!==0x89504e47)throw Error('Invalid PNG: '+relative);
   const padding=Buffer.alloc((4-binary.length%4)%4);binary=Buffer.concat([binary,padding]);
   const view=doc.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:png.length})-1;
   binary=Buffer.concat([binary,png]);
   const image=doc.images.push({name:path.basename(relative),mimeType:'image/png',bufferView:view})-1;
   index=doc.textures.push({source:image,sampler,name:path.basename(relative)})-1;
   textures.set(relative,index);
  }
  return {index,texCoord:0};
 }
 for(const material of doc.materials??[]){
  const definition=data.materials[material.name];if(!definition?.texture)continue;
  material.pbrMetallicRoughness.baseColorTexture=await texture(definition.texture);
  if(definition.emissive)material.emissiveTexture=material.pbrMetallicRoughness.baseColorTexture;
 }
 if(data.designs){
  const config=data.designs,baseMaterials=doc.materials.map(m=>structuredClone(m));
  const changed=new Set(config.options.flatMap(v=>Object.keys(v.materials)));
  const mappings=new Map();
  for(let i=0;i<baseMaterials.length;i++){
   const original=baseMaterials[i];if(!changed.has(original.name))continue;
   const variants=[];
   for(let v=0;v<config.options.length;v++){
    const option=config.options[v],override=option.materials[original.name]||{};
    const material=structuredClone(original),pbr=material.pbrMetallicRoughness;
    if(override.color)pbr.baseColorFactor=[...new Color(override.color).toArray(),pbr.baseColorFactor?.[3]??1];
    if(override.roughness!==undefined)pbr.roughnessFactor=override.roughness;
    if(Object.hasOwn(override,'texture')){
     if(override.texture)pbr.baseColorTexture=await texture(override.texture);
     else delete pbr.baseColorTexture;
    }
    let index=i;
    if(option.id===config.default)doc.materials[i]=material;
    else {material.name=original.name+'__'+option.id;index=doc.materials.push(material)-1;}
    variants.push({material:index,variants:[v]});
   }
   mappings.set(i,variants);
  }
  for(const mesh of doc.meshes)for(const primitive of mesh.primitives){
   const variants=mappings.get(primitive.material);if(!variants)continue;
   primitive.extensions??={};primitive.extensions.KHR_materials_variants={mappings:variants};
  }
  doc.extensions??={};doc.extensions.KHR_materials_variants={variants:config.options.map(v=>({name:v.name,extras:{id:v.id}}))};
  doc.extensionsUsed??=[];doc.extensionsUsed.push('KHR_materials_variants');
 }
 doc.buffers[0].byteLength=binary.length;
 const rawJson=Buffer.from(JSON.stringify(doc));
 const json=Buffer.concat([rawJson,Buffer.alloc((4-rawJson.length%4)%4,32)]);
 const bin=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);
 const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+bin.length,8);
 const jh=Buffer.alloc(8);jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);
 const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
 return Buffer.concat([header,jh,json,bh,bin]);
}

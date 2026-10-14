// Embed the tracked PNG artwork in GLB using standard glTF buffer views.
// This keeps the build independent from native rasterizers and makes the downloaded GLB self-contained.
import fs from 'node:fs/promises';
import path from 'node:path';
export async function embedTextures(glb,data,root){
 const source=Buffer.from(glb),jsonLength=source.readUInt32LE(12);
 const doc=JSON.parse(source.subarray(20,20+jsonLength).toString('utf8').trim());
 const binaryOffset=20+jsonLength;
 let binary=source.subarray(binaryOffset+8,binaryOffset+8+source.readUInt32LE(binaryOffset));
 doc.images??=[];doc.textures??=[];doc.samplers??=[];
 const sampler=doc.samplers.push({magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497})-1;
 const textures=new Map();
 for(const material of doc.materials??[]){
  const definition=data.materials[material.name];if(!definition?.texture)continue;
  let index=textures.get(definition.texture);
  if(index===undefined){
   const relative=definition.texture;
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
  material.pbrMetallicRoughness.baseColorTexture={index,texCoord:0};
  if(definition.emissive)material.emissiveTexture={index,texCoord:0};
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

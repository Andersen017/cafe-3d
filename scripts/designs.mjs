// Material variants share all geometry, transforms and layer visibility.
export function designById(config,id){
  return config.options.find(v=>v.id===id)||config.options.find(v=>v.id===config.default);
}
export function nextDesign(config,id){
  const current=designById(config,id);
  return config.options[(config.options.indexOf(current)+1)%config.options.length];
}

export async function createDesignController(gltf,config){
  const parser=gltf.parser,extension=parser.json.extensions?.KHR_materials_variants;
  if(!extension||extension.variants.length!==config.options.length)throw Error('Design variants missing from GLB');
  const entries=[];
  gltf.scene.traverse(object=>{
    if(!object.isMesh)return;
    const ref=parser.associations.get(object);
    const primitive=parser.json.meshes[ref?.meshes]?.primitives[ref?.primitives];
    const mappings=primitive?.extensions?.KHR_materials_variants?.mappings;
    if(mappings)entries.push({object,mappings,materials:[]});
  });
  if(!entries.length)throw Error('No design surfaces found');
  const indices=new Set(entries.flatMap(e=>e.mappings.map(m=>m.material)));
  const materials=new Map(await Promise.all([...indices].map(async i=>[i,await parser.getDependency('material',i)])));
  for(const entry of entries){
    const original=entry.object.material;
    for(let i=0;i<config.options.length;i++){
      const mapping=entry.mappings.find(m=>m.variants.includes(i));
      if(!mapping)throw Error('Incomplete design mapping');
      entry.object.material=materials.get(mapping.material);
      // Preserve geometry-dependent flags (in particular lamella vertex colours).
      parser.assignFinalMaterial(entry.object);
      entry.materials[i]=entry.object.material;
    }
    entry.object.material=original;
  }
  let active=config.default;
  return {
    get active(){return active;},
    get surfaceCount(){return entries.length;},
    set(id){
      active=designById(config,id).id;
      const index=config.options.findIndex(v=>v.id===active);
      for(const e of entries)e.object.material=e.materials[index];
      return designById(config,active);
    }
  };
}

// Partition immutable source triangles; source face numbers stay in canonical data.
export function selectMeshFaces(positions,indices,selection,cuts=[]){
  if(!selection)return {positions,indices,cuts};
  const {mode,ranges}=selection;
  if(!['include','exclude'].includes(mode))throw Error('Invalid source face selection');
  const marked=new Uint8Array(indices.length/3);
  let previous=-1;
  for(const [a,b] of ranges){
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<=previous||a>b||b>=marked.length)throw Error('Invalid source face range');
    marked.fill(1,a,b+1);previous=b;
  }
  const selected=[],mapping=new Map();
  for(let f=0;f<marked.length;f++)if(!!marked[f]===(mode==='include')){
    mapping.set(f,selected.length/3);selected.push(indices[f*3],indices[f*3+1],indices[f*3+2]);
  }
  const includedCuts=[];
  for(const cut of cuts){
    const faces=cut.faces.map(f=>mapping.get(f));
    if(faces.every(f=>f!==undefined))includedCuts.push({...cut,faces});
    else if(faces.some(f=>f!==undefined))throw Error('An opening straddles source partitions');
  }
  if(mode==='include'){
    const vertices=new Map(),compact=[];
    for(let k=0;k<selected.length;k++){
      const id=selected[k];if(!vertices.has(id)){vertices.set(id,compact.length/3);compact.push(positions[id*3],positions[id*3+1],positions[id*3+2]);}
      selected[k]=vertices.get(id);
    }
    positions=new Float32Array(compact);
  }
  return {positions,indices:new Uint32Array(selected),cuts:includedCuts};
}

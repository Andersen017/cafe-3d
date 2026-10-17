// Temporary visual coordination only. Original source geometry stays in its own layer.
export function subtractVisualBox(positions,indices,bounds){
  const outP=Array.from(positions),outI=[];
  const clip=(poly,axis,value,sign)=>{
    const result=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[(i+poly.length-1)%poly.length],b=poly[i],da=sign*(a[axis]-value),db=sign*(b[axis]-value);
      if((da>=0)!==(db>=0)){const t=da/(da-db);result.push(a.map((v,j)=>v+(b[j]-v)*t));}
      if(db>=0)result.push(b);
    }return result;
  };
  const emit=poly=>{for(let i=1;i<poly.length-1;i++){
    const a=poly[0],b=poly[i],c=poly[i+1],u=b.map((v,j)=>v-a[j]),v=c.map((v,j)=>v-a[j]);
    if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-12)continue;
    const n=outP.length/3;outP.push(...a,...b,...c);outI.push(n,n+1,n+2);
  }};
  for(let f=0;f<indices.length;f+=3){
    const p=[0,1,2].map(k=>Array.from(positions.subarray(indices[f+k]*3,indices[f+k]*3+3)));
    if([0,1,2].some(a=>Math.max(...p.map(v=>v[a]))<=bounds.min[a]||Math.min(...p.map(v=>v[a]))>=bounds.max[a])){outI.push(indices[f],indices[f+1],indices[f+2]);continue;}
    let rest=p;
    for(let a=0;a<3&&rest.length;a++)for(const [value,sign] of [[bounds.min[a],1],[bounds.max[a],-1]]){
      if(!rest.length)break;emit(clip(rest,a,value,-sign));rest=clip(rest,a,value,sign);
    }
  }
  return {positions:new Float32Array(outP),indices:new Uint32Array(outI)};
}

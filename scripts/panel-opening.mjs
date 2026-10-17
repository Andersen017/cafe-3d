// Open an explicitly identified flat infill panel; never remove factory profiles.
// The original vertex prefix and all other face indices remain byte-identical.
export function openPlanarPanel(positions,indices,cut){
  if(!cut)return {positions,indices};
  const {faces,panel:[x0,y0,x1,y1],opening:[a,b,c,d],z}=cut;
  if(faces.length!==2||new Set(faces).size!==2||!(x0<a&&a<c&&c<x1&&y0<b&&b<d&&d<y1))throw Error('Invalid panel opening');
  let area=0,winding;
  for(const face of faces){
    if(!Number.isInteger(face)||face<0||face*3+2>=indices.length)throw Error('Invalid source panel face');
    const ps=[0,1,2].map(k=>Array.from(positions.subarray(indices[face*3+k]*3,indices[face*3+k]*3+3)));
    for(const p of ps)if(Math.abs(p[2]-z)>1e-7||![x0,x1].some(v=>Math.abs(p[0]-v)<1e-6)||![y0,y1].some(v=>Math.abs(p[1]-v)<1e-6))throw Error('Panel cut would affect a profile');
    const cross=(ps[1][0]-ps[0][0])*(ps[2][1]-ps[0][1])-(ps[1][1]-ps[0][1])*(ps[2][0]-ps[0][0]);
    if(winding&&Math.sign(cross)!==winding)throw Error('Inconsistent panel winding');
    winding=Math.sign(cross);area+=Math.abs(cross)/2;
  }
  if(Math.abs(area-(x1-x0)*(y1-y0))>1e-5)throw Error('Source faces are not the specified rectangular infill');
  const outP=new Float32Array(positions.length+48);outP.set(positions);
  const outI=new Uint32Array(indices.length-6+24);const removed=new Set(faces);let n=0;
  for(let f=0;f<indices.length/3;f++)if(!removed.has(f)){outI.set(indices.subarray(f*3,f*3+3),n);n+=3;}
  let v=positions.length/3;
  for(const [l,bot,r,top] of [[x0,y0,a,y1],[c,y0,x1,y1],[a,y0,c,b],[a,d,c,y1]]){
    outP.set([l,bot,z,r,bot,z,r,top,z,l,top,z],v*3);
    outI.set(winding>0?[v,v+1,v+2,v,v+2,v+3]:[v,v+2,v+1,v,v+3,v+2],n);n+=6;v+=4;
  }
  return {positions:outP,indices:outI};
}

export function openPlanarPanels(positions,indices,cuts=[]){
  // Higher source face numbers first: removing them leaves lower indices stable.
  let result={positions,indices};
  for(const cut of [...cuts].sort((a,b)=>Math.min(...b.faces)-Math.min(...a.faces)))result=openPlanarPanel(result.positions,result.indices,cut);
  return result;
}

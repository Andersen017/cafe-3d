export function inPolygon(x,z,points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const [xi,zi]=points[i], [xj,zj]=points[j];
    if((zi>z)!==(zj>z) && x < (xj-xi)*(z-zi)/(zj-zi)+xi) inside=!inside;
  }
  return inside;
}

export function groundAt(x,z,data) {
  for(const surface of data.walk.surfaces) if(inPolygon(x,z,surface.points))return surface.height;
  return null;
}

export function walkBlocked(x,z,data,radius=.19) {
  if(groundAt(x,z,data)===null)return true;
  for(const o of data.walk.obstacles) {
    if(o.variant && o.variant!==(data.activeVariant || data.variants?.default || 'km'))continue;
    if(o.points){
      if(inPolygon(x,z,o.points))return true;
      for(let i=0;i<o.points.length;i++){
        const a=o.points[i],b=o.points[(i+1)%o.points.length],dx=b[0]-a[0],dz=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
        if((x-a[0]-t*dx)**2+(z-a[1]-t*dz)**2<radius*radius)return true;
      }
      continue;
    }
    const dx=x-o.center[0], dz=z-o.center[1], a=o.rotation || 0;
    const rx=dx*Math.cos(a)-dz*Math.sin(a), rz=dx*Math.sin(a)+dz*Math.cos(a);
    const nearX=Math.max(-o.size[0]/2,Math.min(o.size[0]/2,rx));
    const nearZ=Math.max(-o.size[1]/2,Math.min(o.size[1]/2,rz));
    if((rx-nearX)**2+(rz-nearZ)**2<radius*radius)return true;
  }
  return false;
}

export function moveWalker(position,dx,dz,data,radius=.19) {
  let [x,z]=position;
  const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.045));
  for(let i=0;i<n;i++) {
    if(!walkBlocked(x+dx/n,z,data,radius))x+=dx/n;
    if(!walkBlocked(x,z+dz/n,data,radius))z+=dz/n;
  }
  return [x,z,groundAt(x,z,data)];
}

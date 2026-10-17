import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Few batched meshes and visible-edge lines; no photo textures or shadow passes.
export function addContext(group,s,mat,prismGeometry){
  const parts=new Map(),ink=[];
  const segment=(a,b)=>ink.push(...a,...b);
  const ring=(points,y)=>{for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];segment([a[0],y,a[1]],[b[0],y,b[1]]);}};
  function add(key,geometry){if(!parts.has(key))parts.set(key,[]);parts.get(key).push(geometry);}
  function surface(points,holes,y){
    const contours=[points,...holes],flat=contours.flat(),vec=pp=>pp.map(p=>new THREE.Vector2(...p));
    const triangles=THREE.ShapeUtils.triangulateShape(vec(points),holes.map(vec)),p=[];
    for(const face of triangles)for(const i of face)p.push(flat[i][0],y,flat[i][1]);
    for(const pp of contours)for(let i=0;i<pp.length;i++){
      const a=pp[i],b=pp[(i+1)%pp.length];p.push(a[0],y,a[1],b[0],y,b[1],b[0],-.218,b[1],a[0],y,a[1],b[0],-.218,b[1],a[0],-.218,a[1]);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
  }
  if(s.type==='contextBuildings')for(const b of s.buildings){
    const g=prismGeometry(b.points,-.2,b.height-.2);add('context_building',g);
    const edges=new THREE.EdgesGeometry(g,25);ink.push(...edges.attributes.position.array);edges.dispose();
    for(let floor=1;floor<b.floorCount;floor++)ring(b.points,-.2+b.height*floor/b.floorCount);
  }
  if(s.type==='contextPaving'){
    for(const p of s.surfaces){const y={road:-.194,walk:-.154,lawn:-.177,neutral:-.207}[p.kind];add('context_'+p.kind,surface(p.points,p.holes||[],y));}
    for(const path of s.paths)for(let i=1;i<path.points.length;i++){
      const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.0001)continue;
      const y=path.raised?-.139:-.137;segment([a[0],y,a[1]],[b[0],y,b[1]]);
      if(path.raised){const nx=-dz/length*.045,nz=dx/length*.045;add('context_curb',prismGeometry([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]],-.21,-.14));}
    }
  }
  if(s.type==='contextFences')for(const path of s.paths)for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),n=Math.max(1,Math.ceil(length/2.4));
    for(const y of [.1,path.height-.2])segment([a[0],y,a[1]],[b[0],y,b[1]]);
    for(let k=0;k<=n;k++){const x=a[0]+dx*k/n,z=a[1]+dz*k/n;segment([x,-.2,z],[x,path.height-.2,z]);}
  }
  if(s.type==='contextTrees')for(const t of s.trees){
    const [x,z]=t.center,h=t.height,r=t.radius,cy=h*.67;
    segment([x,-.2,z],[x,cy,z]);
    for(let plane=0;plane<3;plane++)for(let k=0;k<32;k++){
      const point=a=>{const u=Math.cos(a)*r,v=Math.sin(a)*(plane===0?r:h*.33);return plane===0?[x+u,cy,z+v]:plane===1?[x+u,cy+v,z]:[x,cy+v,z+u];};
      segment(point(k/32*Math.PI*2),point((k+1)/32*Math.PI*2));
    }
  }
  for(const [key,geometries] of parts){
    const merged=mergeGeometries(geometries,false),p=merged.attributes.position.array,clean=[];
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    for(let i=0;i<p.length;i+=9){a.fromArray(p,i);b.fromArray(p,i+3).sub(a);c.fromArray(p,i+6).sub(a);if(b.cross(c).lengthSq()>1e-14)clean.push(...p.subarray(i,i+9));}
    merged.dispose();const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(clean,3));geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,mat(key));mesh.userData.context=true;mesh.castShadow=false;mesh.receiveShadow=false;group.add(mesh);
    for(const g of geometries)g.dispose();
  }
  if(ink.length){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(ink,3));
    const trees=s.type==='contextTrees';
    const lines=new THREE.LineSegments(geometry,new THREE.MeshBasicMaterial({color:mat('context_ink').color,transparent:trees,opacity:trees?.45:1,depthWrite:!trees}));lines.userData.context=true;lines.name='context-visible-edges';group.add(lines);
  }
}

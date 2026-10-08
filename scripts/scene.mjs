import * as THREE from 'three';

const round = v => Math.round(v * 1e6) / 1e6;

export function prismGeometry(points, bottom, top, slope = 0, originZ = 0) {
  const contour = points.map(([x,z]) => new THREE.Vector2(x,z));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const verts = [];
  const low = i => [points[i][0], bottom + slope*(points[i][1]-originZ), points[i][1]];
  const high = i => [points[i][0], top + slope*(points[i][1]-originZ), points[i][1]];
  const push = (a,b,c) => verts.push(...a,...b,...c);
  for (const [a,b,c] of triangles) {
    push(low(a), low(b), low(c));
    push(high(c), high(b), high(a));
  }
  for (let i=0;i<points.length;i++) {
    const j=(i+1)%points.length;
    push(low(i),high(i),high(j)); push(low(i),high(j),low(j));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}

export function buildModel(data) {
  const root = new THREE.Group(); root.name='Cafe';
  const layers = new Map(); const elements = new Map(); const materials = new Map();
  for (const l of data.layers) {
    const group = new THREE.Group(); group.name=l.id;
    group.userData={layerId:l.id,title:l.name,defaultVisible:l.defaultVisible};
    root.add(group); layers.set(l.id,group);
  }
  function mat(key, overrides={}) {
    const id=key+JSON.stringify(overrides);
    if (!materials.has(id)) {
      const p=data.materials[key] || data.materials.neutral;
      materials.set(id,new THREE.MeshStandardMaterial({
        color:p.color, roughness:p.roughness ?? .8, metalness:p.metalness ?? 0,
        transparent:!!p.opacity, opacity:p.opacity ?? 1,
        side:THREE.DoubleSide, depthWrite:p.opacity ? false : true, ...overrides
      }));
    }
    return materials.get(id);
  }
  function mesh(group,geometry,key,position,rotation) {
    const m=new THREE.Mesh(geometry,mat(key));
    if(position) m.position.fromArray(position);
    if(rotation) m.rotation.fromArray(rotation);
    m.castShadow=key!=='glass'; m.receiveShadow=true; group.add(m); return m;
  }
  function box(g,s,p,key='neutral',rot=0) {
    return mesh(g,new THREE.BoxGeometry(...s),key,p,[0,rot,0]);
  }
  function cylinder(g,r,h,p,key='neutral',rt=r) {
    return mesh(g,new THREE.CylinderGeometry(rt,r,h,16),key,p);
  }
  function beam(g,a,b,w,d,key='steel') {
    const v=new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
    const m=box(g,[w,v.length(),d],a.map((x,i)=>(x+b[i])/2),key);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());
    return m;
  }
  for (const e of data.elements) {
    const g = new THREE.Group(); g.name=e.id;
    g.userData={elementId:e.id,layerId:e.layer,name:e.name,status:e.status || 'source'};
    layers.get(e.layer).add(g); elements.set(e.id,g);
    const s=e.geometry;
    if(s.type==='box') box(g,s.size,s.center,e.material,s.rotation || 0);
    if(s.type==='prism') mesh(g,prismGeometry(s.points,s.bottom,s.top,s.slope,s.originZ),e.material);
    if(s.type==='beam') beam(g,s.a,s.b,s.width,s.depth,e.material);
    if(s.type==='marker') {
      const p=s.center; const r=.09;
      mesh(g,new THREE.SphereGeometry(r,12,8),e.material,p);
      const ring=mesh(g,new THREE.TorusGeometry(.14,.013,8,24),e.material,p);
      ring.rotation.x=Math.PI/2;
      if (p[1]>.1) beam(g,[p[0],.02,p[2]],[p[0],p[1]-.08,p[2]],.013,.013,e.material);
    }
    if(s.type==='equipment') {
      const [w,h,d]=s.size; const p=s.center;
      g.position.fromArray(p); g.rotation.y=s.rotation || 0;
      const kind=s.kind;
      const thin=Math.min(.035,w/8,d/8);
      if(kind==='table' || kind==='desk' || kind==='shelf') {
        box(g,[w,thin,d],[0,h/2-thin/2,0],e.material);
        if(kind!=='shelf') for(const x of [-1,1])for(const z of [-1,1])
          box(g,[thin,h-thin,thin],[x*(w/2-thin),-thin/2,z*(d/2-thin)],'steel');
      } else if(kind==='chair') {
        const seat=Math.min(.46,h*.55);
        box(g,[w,.065,d*.9],[0,-h/2+seat,0],e.material);
        box(g,[w,h-seat,.055],[0,seat/2,d*.45],e.material);
        for(const x of [-1,1])for(const z of [-1,1])box(g,[.025,seat,.025],[x*w*.36,-h/2+seat/2,z*d*.33],'steel');
      } else if(kind==='rack') {
        for(const y of [0,.25,.5,.75,1]) box(g,[w,.025,d],[0,-h/2+.02+y*(h-.04),0],e.material);
        for(const x of [-1,1])for(const z of [-1,1])box(g,[.03,h,.03],[x*(w/2-.015),0,z*(d/2-.015)],'steel');
      } else if(kind==='detector') {
        const side=Math.min(.05,w*.12);
        for(const x of [-1,1]) box(g,[side,h,d],[x*(w/2-side/2),0,0],e.material);
        box(g,[w,side,d],[0,h/2-side/2,0],e.material);
      } else if(kind==='sink') {
        box(g,[w,.10,d],[0,h/2-.05,0],'steel');
        box(g,[w*.7,.11,d*.6],[0,h/2-.10,0],'dark');
        for(const x of [-1,1])for(const z of [-1,1]) box(g,[.025,h-.10,.025],[x*w*.43,-.05,z*d*.42],'steel');
        beam(g,[0,h/2, -d*.37],[0,h/2+.2,-d*.37],.02,.02,'steel');
        beam(g,[0,h/2+.2,-d*.37],[0,h/2+.2,-d*.16],.02,.02,'steel');
      } else if(kind==='display') {
        box(g,[w,h*.55,d],[0,-h*.225,0],e.material);
        box(g,[w,h*.45,d],[0,h*.275,0],'glass');
        for(const x of [-1,1])for(const z of [-1,1])box(g,[thin,h*.45,thin],[x*(w/2-thin/2),h*.275,z*(d/2-thin/2)],'steel');
        for (const y of [h*.06,h*.275,h*.49])box(g,[w,thin,d],[0,y,0],'steel');
      } else if(kind==='fridge') {
        box(g,[w,h,d],[0,0,0],e.material);
        box(g,[w*.91,h*.86,.012],[0,h*.025,d/2+.006],'white');
        box(g,[.025,Math.min(.38,h*.4),.032],[w*.36,h*.18,d/2+.025],'steel');
      } else if(kind==='monitor') {
        box(g,[w,h*.75,d*.2],[0,h*.12,0],'dark');
        box(g,[w*.1,h*.4,d*.18],[0,-h*.3,0],'steel');
        box(g,[w*.6,.02,d],[0,-h/2+.01,0],'steel');
      } else if(kind==='toilet') {
        cylinder(g,w*.46,h*.65,[0,-h*.175,d*.15],'white',w*.42);
        box(g,[w,h*.72,d*.25],[0,h*.14,-d*.34],'white');
      } else if(kind==='shower') {
        box(g,[w,.07,d],[0,-h/2+.035,0],'white');
      } else if(kind==='symbol') {
        box(g,[w,.015,d],[0,0,0],'symbol');
      } else {
        box(g,[w,h,d],[0,0,0],e.material);
      }
    }
    if(s.type==='opening') {
      const {width:w,height:h,depth:d,center:p,rotation:r,doorWidth:dw=0}=s;
      g.position.fromArray(p); g.rotation.y=r || 0;
      const t=.035;
      // The clear door opening is kept free. The leaf is represented open beside it.
      const fillStart=dw>0?dw:0;
      if(w>fillStart+.03) box(g,[w-fillStart,h,.012],[fillStart/2,0,0],'glass');
      for(const x of [-1,1])box(g,[t,h,d],[x*(w/2-t/2),0,0],'frame');
      for(const y of [-1,1])box(g,[w,t,d],[0,y*(h/2-t/2),0],'frame');
      if(dw>0) {
        const leaf=new THREE.Group();leaf.position.set(-w/2+t,-h/2,0);leaf.rotation.y=(s.swing || -1)*Math.PI/2;g.add(leaf);
        box(leaf,[dw,h,.025],[dw/2,h/2,0],e.material || 'glass');
        for(const x of [0,dw])box(leaf,[t,h,d],[x,h/2,0],'frame');
        for(const y of [0,h])box(leaf,[dw,t,d],[dw/2,y,0],'frame');
      }
      if(!dw && w>1.4) {
        const count=Math.ceil(w/1.2);
        for(let n=1;n<count;n++)box(g,[t,h,d],[-w/2+w*n/count,0,0],'frame');
        if(h>2.4) box(g,[w,t,d],[0,.3,0],'frame');
      }
    }
  }
  root.updateMatrixWorld(true);
  return {root,layers,elements};
}

export function modelBounds(root) {
  const b=new THREE.Box3().setFromObject(root);
  return {min:b.min.toArray().map(round),max:b.max.toArray().map(round)};
}

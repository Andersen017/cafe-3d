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

export function buildModel(data,meshAssets=new Map()) {
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
    g.userData={elementId:e.id,layerId:e.layer,name:e.name,status:e.status || 'source',variant:e.variant || 'common',costKey:e.costKey || null};
    layers.get(e.layer).add(g); elements.set(e.id,g);
    const s=e.geometry;
    if(s.type==='box') box(g,s.size,s.center,e.material,s.rotation || 0);
    if(s.type==='prism') mesh(g,prismGeometry(s.points,s.bottom,s.top,s.slope,s.originZ),e.material);
    if(s.type==='beam') beam(g,s.a,s.b,s.width,s.depth,e.material);
    if(s.type==='indexedMesh') {
      const asset=meshAssets.get(s.asset);if(!asset)throw new Error('Missing geometry asset: '+s.asset);
      const geom=new THREE.BufferGeometry();
      geom.setAttribute('position',new THREE.BufferAttribute(new Float32Array(asset,s.positionByteOffset,s.vertexCount*3),3));
      geom.setIndex(new THREE.BufferAttribute(new Uint32Array(asset,s.indexByteOffset,s.indexCount),1));
      geom.computeVertexNormals();geom.computeBoundingBox();geom.computeBoundingSphere();
      const m=mesh(g,geom,e.material);m.castShadow=false;
    }
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
      if(kind==='footprint_table') {
        const pts=s.footprint,base=s.base??0;
        g.position.set(0,0,0);g.rotation.set(0,0,0);
        mesh(g,prismGeometry(pts,base+h-.035,base+h),e.material);
        // Four supports at source outline corners; skip intermediate curve points.
        const corners=pts.filter((p,i)=>{const a=pts[(i+pts.length-1)%pts.length],b=pts[(i+1)%pts.length];const u=new THREE.Vector2(p[0]-a[0],p[1]-a[1]).normalize(),v=new THREE.Vector2(b[0]-p[0],b[1]-p[1]).normalize();return Math.abs(u.dot(v))<.8;});
        for(const p of corners.slice(0,6))box(g,[.035,h-.035,.035],[p[0]+(s.center[0]-p[0])*.055,base+(h-.035)/2,p[1]+(s.center[2]-p[1])*.055],'steel');
      } else if(kind==='corner_display') {
        const pts=s.footprint;const base=s.base ?? 0;
        g.position.set(0,0,0);g.rotation.set(0,0,0);
        mesh(g,prismGeometry(pts,base,base+h*.55),e.material);
        mesh(g,prismGeometry(pts,base+h*.55,base+h),'glass');
        for(const level of [.58,.77,.96])mesh(g,prismGeometry(pts,base+h*level,base+h*level+.014),'steel');
        for(const [x,z] of pts)beam(g,[x,base+h*.55,z],[x,base+h,z],.022,.022,'steel');
      } else if(kind==='round_table') {
        cylinder(g,w/2,.035,[0,h/2-.0175,0],e.material);
        cylinder(g,.055,h-.035,[0,-.0175,0],'steel');
        cylinder(g,w*.33,.028,[0,-h/2+.014,0],'steel');
      } else if(kind==='table' || kind==='desk' || kind==='shelf' || kind==='work_table') {
        box(g,[w,thin,d],[0,h/2-thin/2,0],e.material);
        if(kind!=='shelf') for(const x of [-1,1])for(const z of [-1,1])
          box(g,[thin,h-thin,thin],[x*(w/2-thin),-thin/2,z*(d/2-thin)],'steel');
        if(kind==='work_table'){box(g,[w,.022,d],[0,-h*.25,0],'steel');box(g,[w,.10,.018],[0,h/2+.05,-d/2],e.material);}
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
      } else if(kind==='cold_table') {
        box(g,[w,h*.88,d],[0,-h*.06,0],e.material);box(g,[w,.035,d],[0,h/2-.018,0],'steel');
        for(const x of [-w*.25,w*.25]){box(g,[w*.46,h*.68,.015],[x,-.015,d/2+.008],'white');box(g,[w*.18,.025,.035],[x,h*.25,d/2+.03],'steel');}
        box(g,[w,.10,.018],[0,h/2+.05,-d/2],'steel');
      } else if(kind==='fridge' || kind==='cabinet') {
        box(g,[w,h,d],[0,0,0],e.material);
        box(g,[w*.91,h*.86,.012],[0,h*.025,d/2+.006],'white');
        box(g,[.025,Math.min(.38,h*.4),.032],[w*.36,h*.18,d/2+.025],'steel');
      } else if(kind==='espresso') {
        box(g,[w,h*.7,d*.72],[0,h*.15,-d*.14],e.material);
        box(g,[w,.035,d],[0,-h/2+.018,0],'dark');
        for(const x of [-w*.23,w*.23]){
          cylinder(g,.047,.10,[x,-h*.03,d*.13],'steel');
          beam(g,[x,-h*.03,d*.13],[x,-h*.03,d*.40],.024,.024,'dark');
          box(g,[.085,.055,.025],[x,h*.20,d*.23],'dark');
        }
        beam(g,[-w*.42,h*.10,d*.12],[-w*.42,-h*.35,d*.35],.018,.018,'steel');
      } else if(kind==='grinder' || kind==='blender') {
        box(g,[w,h*.38,d],[0,-h*.31,0],e.material);
        cylinder(g,w*.34,h*.45,[0,h*.08,0],kind==='grinder'?'glass':'glass',w*.42);
        cylinder(g,w*.43,.028,[0,h*.31,0],'dark');
        if(kind==='grinder')box(g,[w*.38,h*.19,d*.28],[0,-h*.08,d*.42],'steel');
      } else if(kind==='juicer') {
        cylinder(g,w*.42,h*.65,[0,-h*.17,0],e.material);cylinder(g,w*.35,h*.32,[0,h*.28,0],'glass');
        box(g,[w*.35,h*.25,d*.35],[w*.40,-h*.1,0],'dark');
      } else if(kind==='boiler') {
        cylinder(g,Math.min(w,d)*.47,h*.90,[0,0,0],e.material);
        cylinder(g,Math.min(w,d)*.49,.025,[0,h*.46,0],'dark');
        box(g,[w*.13,.028,d*.23],[0,-h*.29,d*.52],'dark');
      } else if(kind==='microwave' || kind==='sterilizer') {
        box(g,[w,h,d],[0,0,0],e.material);
        box(g,[w*.69,h*.72,.018],[-w*.10,0,d/2+.01],'dark');
        box(g,[w*.045,h*.5,.035],[w*.29,0,d/2+.03],'steel');
      } else if(kind==='scale') {
        box(g,[w,h*.70,d],[0,-h*.15,0],e.material);box(g,[w*.85,.015,d*.75],[0,h*.24,-d*.07],'steel');
        box(g,[w*.32,h*.17,.012],[0,-h*.15,d/2+.009],'dark');
      } else if(kind==='slicer') {
        box(g,[w,.065,d],[0,-h/2+.033,0],e.material);
        const disk=mesh(g,new THREE.CylinderGeometry(Math.min(h*.42,.15),Math.min(h*.42,.15),.026,32), 'steel',[w*.16,h*.01,0]);disk.rotation.z=Math.PI/2;
        box(g,[w*.42,.035,d*.70],[-w*.22,-h*.05,d*.05],'steel');
      } else if(kind==='bin') {
        box(g,[w*.9,h*.92,d*.9],[0,-h*.04,0],e.material);box(g,[w,.03,d],[0,h*.46,0],'dark');
      } else if(kind==='armchair') {
        box(g,[w*.82,.13,d*.8],[0,-h*.05,0],e.material);
        box(g,[w*.9,h*.46,.13],[0,h*.25,d*.37],e.material);
        for(const x of [-1,1])box(g,[w*.13,h*.3,d*.9],[x*w*.44,h*.1,0],e.material);
        for(const x of [-1,1])for(const z of [-1,1])box(g,[.035,h*.36,.035],[x*w*.35,-h*.32,z*d*.33],'steel');
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

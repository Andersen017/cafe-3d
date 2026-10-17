import * as THREE from 'three';

// Lightweight architectural entourage, built as batched 3D line drawings.
export function addScenery(group,s){
  function drawing(parent,name,color='#7895a6'){
    const positions=[];
    const line=(...points)=>{for(let i=1;i<points.length;i++)positions.push(...points[i-1],...points[i]);};
    const ellipse=(c,rx,ry,plane='xy',n=24)=>{
      for(let i=0;i<n;i++){
        const p=a=>plane==='xy'?[c[0]+rx*Math.cos(a),c[1]+ry*Math.sin(a),c[2]]:plane==='yz'?[c[0],c[1]+ry*Math.sin(a),c[2]+rx*Math.cos(a)]:[c[0]+rx*Math.cos(a),c[1],c[2]+ry*Math.sin(a)];
        line(p(i/n*Math.PI*2),p((i+1)/n*Math.PI*2));
      }
    };
    function finish(){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      // MeshBasicMaterial lets GLTFExporter retain line topology without lighting.
      const o=new THREE.LineSegments(g,new THREE.MeshBasicMaterial({color}));o.name=name;o.userData={context:true,sceneryInk:true};parent.add(o);return o;
    }
    return {line,ellipse,finish};
  }
  function box(d,x,y,z,w,h,l){
    for(const yy of [y,y+h])d.line([x-w/2,yy,z-l/2],[x+w/2,yy,z-l/2],[x+w/2,yy,z+l/2],[x-w/2,yy,z+l/2],[x-w/2,yy,z-l/2]);
    for(const xx of [x-w/2,x+w/2])for(const zz of [z-l/2,z+l/2])d.line([xx,y,zz],[xx,y+h,zz]);
  }
  if(s.type==='contextSky'){
    for(const [i,c] of s.clouds.entries()){
      const g=new THREE.Group();g.position.fromArray(c.center);g.userData.contextMotion={kind:'cloud',rate:.025,amplitude:1.8,phase:i*1.8};group.add(g);
      const d=drawing(g,'cloud-outline');
      // Scalloped contour and one depth contour, rather than overlapping spheres.
      const outline=[[-2.3,0],[-2.6,.25],[-2.5,.65],[-2.05,.83],[-1.7,.76],[-1.55,1.2],[-1.1,1.5],[-.55,1.45],[-.2,1.13],[.1,1.52],[.65,1.72],[1.2,1.55],[1.5,1.02],[1.95,1.05],[2.4,.8],[2.6,.4],[2.35,0],[-2.3,0]];
      for(const z of [-.24,.24])d.line(...outline.map(([x,y])=>[x*c.scale,y*c.scale,z]));
      d.line([-2.3*c.scale,0,-.24],[-2.3*c.scale,0,.24]);d.line([2.35*c.scale,0,-.24],[2.35*c.scale,0,.24]);d.finish();
    }
    const birds=new THREE.Group();birds.position.fromArray(s.birdsCenter);birds.userData.contextMotion={kind:'birds'};group.add(birds);
    const b=drawing(birds,'four-birds');
    for(const [x,y,z,k] of [[0,0,0,1],[1.6,.5,-.7,.8],[-1.7,.8,-1.1,.7],[3,1,-1.8,.65]]){
      b.line([x-.65*k,y+.18*k,z],[x-.3*k,y+.28*k,z+.05],[x,y,z+.1],[x+.3*k,y+.28*k,z+.05],[x+.65*k,y+.18*k,z]);
      b.line([x,y,z+.1],[x,y-.08*k,z+.3]);
    }b.finish();
    for(const mode of ['day','evening']){
      const g=new THREE.Group();g.position.fromArray(s.celestialCenter);g.userData.skyMode=mode;group.add(g);
      const d=drawing(g,mode==='day'?'sun':'crescent',mode==='day'?'#c1a46a':'#a8c8dd');
      if(mode==='day'){
        d.ellipse([0,0,0],.85,.85);d.ellipse([0,0,0],.85,.85,'yz');
        for(let i=0;i<12;i++){const a=i/12*Math.PI*2;d.line([Math.cos(a)*1.12,Math.sin(a)*1.12,0],[Math.cos(a)*1.45,Math.sin(a)*1.45,0]);}
      }else{
        const outer=[],inner=[];for(let i=0;i<=40;i++){
          const a=(60+i/40*240)*Math.PI/180;outer.push([Math.cos(a),Math.sin(a),0]);
          const y=Math.sin(Math.PI/3)*(1-2*i/40);inner.push([.5-.72*Math.sin(i/40*Math.PI),y,.01]);
        }d.line(...outer);d.line(...inner);d.line([1.8,.5,0],[1.8,.92,0]);d.line([1.59,.71,0],[2.01,.71,0]);
      }
      const ink=d.finish();ink.userData.sceneryInk=false;
    }
  }
  if(s.type==='contextPeople'){
    const d=drawing(group,'people-dogs-and-stroller');
    function person(x,z,scale=1,angle=0,pose='walk'){
      const transform=([a,b,c])=>[x+(a*Math.cos(angle)+c*Math.sin(angle))*scale,-.15+b*scale,z+(-a*Math.sin(angle)+c*Math.cos(angle))*scale];
      const line=(...p)=>d.line(...p.map(transform));
      // Head and torso have volume; limb contours give a walking pose.
      for(const plane of ['xy','yz']){
        const pts=[];for(let i=0;i<=20;i++){const a=i/20*Math.PI*2;pts.push(transform(plane==='xy'?[.12*Math.cos(a),1.6+.15*Math.sin(a),0]:[0,1.6+.15*Math.sin(a),.12*Math.cos(a)]));}d.line(...pts);
      }
      for(const zz of [-.085,.085]){
        line([-.12,1.43,zz],[-.22,1.35,zz],[-.16,.84,zz],[.16,.84,zz],[.22,1.35,zz],[.12,1.43,zz]);
        line([-.16,.84,zz],[-.23,.48,zz+.1],[-.32,.08,zz+.16],[-.16,.05,zz+.22],[-.1,.43,zz+.14],[0,.78,zz]);
        line([0,.78,zz],[.11,.44,zz-.13],[.21,.04,zz-.2],[.36,.04,zz-.12],[.21,.49,zz-.07],[.16,.84,zz]);
      }
      line([-.22,1.35,0],[-.35,1.06,.08],[-.38,.87,.22]);
      line([.22,1.35,0],[.38,1.1,pose==='stroller'?.4:-.12],[.46,1.02,pose==='stroller'?.65:-.24]);
      line([-.12,1.43,-.085],[-.12,1.43,.085]);line([.16,.84,-.085],[.16,.84,.085]);
    }
    function dog(x,z){
      for(const dx of [-.12,.12]){
        d.line([x+dx,.18,z-.35],[x+dx,.43,z-.29],[x+dx,.46,z+.17],[x+dx,.61,z+.28],[x+dx,.53,z+.46],[x+dx,.37,z+.34],[x+dx,.31,z-.23],[x+dx,.18,z-.35]);
        for(const zz of [-.2,.18])d.line([x+dx,.35,z+zz],[x+dx,-.12,z+zz+.05]);
      }d.line([x,.4,z-.3],[x,.62,z-.55]);d.line([x,.53,z+.25],[x-.09,.72,z+.26],[x+.09,.64,z+.29]);
    }
    for(const p of s.people)person(...p);
    const [sx,sz]=s.stroller;box(d,sx,.28,sz,.52,.32,.68);
    for(const xx of [sx-.29,sx+.29])for(const zz of [sz-.3,sz+.3])d.ellipse([xx,.03,zz],.14,.14,'yz',16);
    for(const xx of [sx-.26,sx+.26]){
      d.line([xx,.1,sz-.3],[xx,.43,sz+.25],[xx,.88,sz+.65]);
      d.line([xx,.6,sz-.34],[xx,.84,sz-.24],[xx,.9,sz],[xx,.6,sz+.22]);
    }d.line([sx-.26,.88,sz+.65],[sx+.26,.88,sz+.65]);
    const [dx,dz]=s.dog,handler=s.people.at(-1);dog(dx,dz);d.line([dx,.53,dz+.25],[handler[0]+.46,.87,handler[1]-.24]);
    d.finish();
  }
  if(s.type==='contextVehicle'){
    const g=new THREE.Group();g.position.fromArray(s.center);g.rotation.y=s.rotation||0;
    if(s.motion)g.userData.contextMotion=s.motion;group.add(g);
    const d=drawing(g,s.ambulance?'ambulance-outline':'passing-car-outline');
    const w=s.ambulance?2.05:1.8,l=s.ambulance?5.4:4.3;
    box(d,0,.36,0,w,.64,l);
    const cab=s.ambulance?[[.36,-2.3],[1.65,-2.3],[2.25,-1.8],[2.25,.9],[1.35,1.6],[1,2.1]]:[[1,-1.9],[1.45,-1.15],[1.45,.65],[1,1.5]];
    for(const x of [-w/2,w/2])d.line(...cab.map(([y,z])=>[x*.9,y,z]));
    const roofY=s.ambulance?2.25:1.45,roofBack=s.ambulance?-1.8:-1.15,roofFront=s.ambulance?.9:.65;
    for(const z of [roofBack,roofFront])d.line([-w*.45,roofY,z],[w*.45,roofY,z]);
    d.line([-w*.45,1,1.5],[w*.45,1,1.5]);
    for(const x of [-w*.51,w*.51])for(const z of [-l*.31,l*.31]){
      d.ellipse([x,.34,z],.34,.34,'yz');d.ellipse([x,.34,z],.18,.18,'yz',16);
    }
    for(const x of [-w*.32,w*.32])box(d,x,.65,l/2+.005,.35,.13,.02);
    for(const x of [-w*.45,w*.45])d.line([x,1,0],[x,roofY,0]);
    d.finish();
    if(s.ambulance){
      const red=drawing(g,'ambulance-cross','#a77f79');
      for(const x of [-w*.505,w*.505]){
        red.line([x,1.3,-.65],[x,1.95,-.65]);red.line([x,1.625,-.98],[x,1.625,-.32]);
      }box(red,0,2.25,.4,1.1,.16,.25);const o=red.finish();o.userData.sceneryInk=false;
    }
  }
}

import * as THREE from 'three';
import {pedestrianPose} from './scenery-motion.mjs';

function pen(){
  const points=[];
  const line=(...p)=>{for(let i=1;i<p.length;i++)points.push(...p[i-1],...p[i]);};
  const ring=(c,rx,ry,plane='xy',n=20)=>{
    const p=a=>plane==='xy'?[c[0]+rx*Math.cos(a),c[1]+ry*Math.sin(a),c[2]]:plane==='yz'?[c[0],c[1]+ry*Math.sin(a),c[2]+rx*Math.cos(a)]:[c[0]+rx*Math.cos(a),c[1],c[2]+ry*Math.sin(a)];
    for(let i=0;i<n;i++)line(p(i/n*2*Math.PI),p((i+1)/n*2*Math.PI));
  };
  return {points,line,ring};
}
function ink(parent,points,name){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  const o=new THREE.LineSegments(g,new THREE.MeshBasicMaterial({color:'#7895a6'}));
  o.name=name;o.userData={context:true,sceneryInk:true};parent.add(o);return o;
}
function definition(seated,seatHeight=.46,role='guest'){
  const p=pen(),hip=seated?seatHeight+.06:.88,neck=hip+.56,head=neck+.17;
  p.ring([0,head,-.025],.108,.145);p.ring([0,head,-.025],.105,.145,'yz');
  p.line([0,head+.02,-.13],[0,head,-.17],[0,head-.015,-.13]);
  for(const z of [-.08,.08]){
    p.line([-.09,neck,z],[-.21,neck-.08,z],[-.15,hip,z],[.15,hip,z],[.21,neck-.08,z],[.09,neck,z]);
    p.line([-.15,hip,z],[.15,hip,z]);
  }
  p.line([-.09,neck,-.08],[-.09,neck,.08]);p.line([.09,neck,-.08],[.09,neck,.08]);
  p.line([-.08,neck,-.09],[0,neck-.1,-.1],[.08,neck,-.09]);
  if(role==='guard'){
    p.ring([0,head+.13,-.025],.15,.13,'xz');
    p.line([-.13,head+.13,-.05],[-.12,head+.13,-.23],[.12,head+.13,-.23],[.13,head+.13,-.05]);
    p.line([-.14,hip+.06,-.095],[.14,hip+.06,-.095]);
    p.line([.08,neck-.15,-.09],[.14,neck-.15,-.09],[.14,neck-.22,-.09],[.08,neck-.22,-.09],[.08,neck-.15,-.09]);
  }
  if(role==='bartender')p.line([-.10,neck-.13,-.10],[-.13,hip-.08,-.11],[.13,hip-.08,-.11],[.10,neck-.13,-.10],[-.10,neck-.13,-.10]);
  const limbs=[];
  for(const side of [-1,1]){
    const x=side*.105;
    if(seated){
      for(const w of [-.045,.045])p.line([x+w,hip,0],[x+w,hip-.04,-.34],[x+w,.08,-.34],[x+w,.04,-.48],[x+w,.04,-.27],[x+w,hip-.13,-.25],[x+w,hip-.09,.04]);
      p.line([side*.21,neck-.08,0],[side*.27,hip+.22,-.18],[side*.16,hip+.20,-.36]);
    }else{
      const leg=pen();
      for(const w of [-.045,.045])leg.line([w,0,0],[w,-.40,-.01],[w,-.81,0],[w,-.82,-.17],[w,-.86,-.17],[w,-.86,.08],[w,0,.08]);
      limbs.push({points:leg.points,pivot:[x,hip,0],part:'leg',side});
      const arm=pen();
      for(const w of [-.025,.025])arm.line([w,0,0],[w,-.28,-.02],[w,-.57,-.08],[w,-.58,0],[w,-.27,.05],[w,0,.05]);
      limbs.push({points:arm.points,pivot:[side*.225,neck-.08,0],part:'arm',side});
    }
  }
  return {body:p.points,limbs};
}
function transformed(points,center,angle,pivot=[0,0,0]){
  const out=[],c=Math.cos(angle),s=Math.sin(angle);
  for(let i=0;i<points.length;i+=3){const x=points[i]+pivot[0],y=points[i+1]+pivot[1],z=points[i+2]+pivot[2];out.push(center[0]+x*c+z*s,center[1]+y,center[2]-x*s+z*c);}
  return out;
}
export function addOccupants(group,s){
  const batch=[];
  for(const person of s.staticPeople){
    const p=definition(person.pose==='seated',person.seatHeight,person.role);
    batch.push(...transformed(p.body,person.center,person.rotation));
    for(const limb of p.limbs)batch.push(...transformed(limb.points,person.center,person.rotation,limb.pivot));
  }
  ink(group,batch,'seated-guests-and-staff');
  for(const route of s.visitors){
    const person=new THREE.Group();person.name='visitor-'+route.id;person.userData.contextMotion=route;group.add(person);
    const initial=pedestrianPose(0,route);person.position.set(initial.x,initial.y,initial.z);person.rotation.y=initial.yaw;
    const p=definition(false);ink(person,p.body,'visitor-torso');
    for(const limb of p.limbs){
      const part=new THREE.Group();part.position.fromArray(limb.pivot);part.userData.pedestrianLimb={part:limb.part,side:limb.side};person.add(part);ink(part,limb.points,'visitor-'+limb.part);
    }
  }
}

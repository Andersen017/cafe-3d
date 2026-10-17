// Rigid line groups only: no skeletons, physics, geometry rebuilds or extra lights.
export function carPose(distance,m){
  const length=m.zMax-m.zMin,arc=Math.PI*m.radius,total=2*length+2*arc;
  let d=((distance%total)+total)%total,x,z,dx,dz;
  if(d<length){x=m.centerX+m.radius;z=m.zMax-d;dx=0;dz=-1;}
  else if((d-=length)<arc){const a=-d/m.radius;x=m.centerX+m.radius*Math.cos(a);z=m.zMin+m.radius*Math.sin(a);dx=Math.sin(a);dz=-Math.cos(a);}
  else if((d-=arc)<length){x=m.centerX-m.radius;z=m.zMin+d;dx=0;dz=1;}
  else{d-=length;const a=Math.PI-d/m.radius;x=m.centerX+m.radius*Math.cos(a);z=m.zMax+m.radius*Math.sin(a);dx=Math.sin(a);dz=-Math.cos(a);}
  return {x,z,yaw:Math.atan2(dx,dz)};
}

export function createSceneryMotion(model){
  const tracks=[];
  model.traverse(o=>{if(o.userData.contextMotion)tracks.push({object:o,motion:o.userData.contextMotion,base:o.position.clone(),elapsed:0});});
  function update(dt,enabled){
    if(!enabled)return;
    for(const t of tracks){
      let visible=true;for(let p=t.object;p;p=p.parent)if(!p.visible){visible=false;break;}
      if(!visible)continue;
      t.elapsed+=Math.min(Math.max(dt,0),.05);
      const m=t.motion,o=t.object,time=t.elapsed;
      if(m.kind==='car'){const p=carPose((m.phase||0)+time*m.speed,m);o.position.set(p.x,t.base.y,p.z);o.rotation.y=p.yaw;}
      else if(m.kind==='cloud'){o.position.x=t.base.x+Math.sin(time*m.rate+(m.phase||0))*m.amplitude;}
      else if(m.kind==='birds'){
        o.position.x=t.base.x+Math.sin(time*.13)*3;o.position.z=t.base.z+Math.sin(time*.09)*2;
        o.position.y=t.base.y+Math.sin(time*.6)*.18;o.rotation.y=Math.sin(time*.13)*.12;
      }
    }
  }
  update(0,true);return {update,count:tracks.length};
}

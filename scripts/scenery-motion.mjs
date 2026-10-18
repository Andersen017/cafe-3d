// Rigid line groups and four light limb pivots per visitor; no geometry rebuilds.
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const angleTo=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*smooth(t);
export function pedestrianPose(time,m){
  const segments=m.points.slice(1).map((p,i)=>Math.hypot(p[0]-m.points[i][0],p[2]-m.points[i][2]));
  const length=segments.reduce((a,b)=>a+b,0),ramp=.6,duration=length/m.speed+ramp;
  const backStart=m.start+duration+m.wait,end=backStart+duration,turn=m.turnSeconds||1.2;
  const t=((time%m.period)+m.period)%m.period;
  const at=(distance,reverse=false)=>{
    let d=Math.max(0,Math.min(length,distance)),i=0;
    while(i<segments.length-1&&d>segments[i])d-=segments[i++];
    const a=m.points[i],b=m.points[i+1],f=segments[i]?d/segments[i]:0;
    return {x:a[0]+(b[0]-a[0])*f,y:a[1]+(b[1]-a[1])*f,z:a[2]+(b[2]-a[2])*f,yaw:Math.atan2((reverse?1:-1)*(b[0]-a[0]),(reverse?1:-1)*(b[2]-a[2]))};
  };
  const step=(elapsed,reverse)=>{
    const e=Math.max(0,Math.min(duration,elapsed));
    const d=e<ramp?.5*m.speed/ramp*e*e:e>duration-ramp?length-.5*m.speed/ramp*(duration-e)**2:m.speed*(e-ramp/2);
    const velocity=Math.min(1,e/ramp,(duration-e)/ramp);
    return {...at(reverse?length-d:d,reverse),moving:true,leg:reverse?-1:1,travel:d,gait:Math.sin(d*2*Math.PI/.72)*Math.max(0,velocity)};
  };
  if(t>=m.start&&t<m.start+duration)return step(t-m.start,false);
  if(t>=backStart&&t<end)return step(t-backStart,true);
  if(t>=m.start+duration&&t<backStart){const p=at(length);p.yaw=angleTo(p.yaw,p.yaw+Math.PI,(t-(backStart-turn))/turn);return {...p,moving:false,leg:0,gait:0};}
  const p=at(0),forward=p.yaw;
  if(t>=end)p.yaw=angleTo(forward+Math.PI,forward,(t-(m.period-turn))/turn);
  return {...p,moving:false,leg:0,gait:0};
}
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
  model.traverse(o=>{if(o.userData.contextMotion){const limbs=[];if(o.userData.contextMotion.kind==='pedestrian')o.traverse(child=>{if(child.userData.pedestrianLimb)limbs.push(child);});tracks.push({object:o,motion:o.userData.contextMotion,base:o.position.clone(),elapsed:0,limbs});}});
  function update(dt,enabled){
    if(!enabled)return;
    for(const t of tracks){
      let visible=true;for(let p=t.object;p;p=p.parent)if(!p.visible){visible=false;break;}
      if(!visible)continue;
      t.elapsed+=Math.min(Math.max(dt,0),1.2);
      const m=t.motion,o=t.object,time=t.elapsed;
      if(m.kind==='pedestrian'){
        const p=pedestrianPose(time,m);o.position.set(p.x,p.y,p.z);o.rotation.y=p.yaw;
        for(const limb of t.limbs){const l=limb.userData.pedestrianLimb;limb.rotation.x=p.gait*l.side*(l.part==='leg'?.32:-.22);}
      }
      else if(m.kind==='car'){const p=carPose((m.phase||0)+time*m.speed,m);o.position.set(p.x,t.base.y,p.z);o.rotation.y=p.yaw;}
      else if(m.kind==='cloud'){o.position.x=t.base.x+Math.sin(time*m.rate+(m.phase||0))*m.amplitude;}
      else if(m.kind==='birds'){
        o.position.x=t.base.x+Math.sin(time*.13)*3;o.position.z=t.base.z+Math.sin(time*.09)*2;
        o.position.y=t.base.y+Math.sin(time*.6)*.18;o.rotation.y=Math.sin(time*.13)*.12;
      }
    }
  }
  update(0,true);return {update,count:tracks.length};
}

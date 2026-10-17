import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {groundAt,walkBlocked,moveWalker,inPolygon} from './scripts/walk.mjs?v=R10-20261017';
import {elementInVariant,variantById} from './scripts/variants.mjs?v=R10-20261017';
import {createSceneryMotion} from './scripts/scenery-motion.mjs?v=R10-20261017';

const $=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>n.toLocaleString('ru-RU',{maximumFractionDigits:2,minimumFractionDigits:2});
let data,renderer,scene,perspective,orthographic,camera,controls,model;
const layers=new Map(),elementObjects=new Map(),metadata=new Map(),hiddenElements=new Set();
const finishPaints=[];
let activeView='overview',selected=null,sliceActive=false,sliceHeight=1.6;
let activeVariant='lstk';
let environmentMode='evening',environmentLights,facadeFixtures=[],lastLightUpdate=0;
let sceneryMotion,animationEnabled=!matchMedia('(prefers-reduced-motion: reduce)').matches,contextMuted=false;
let contextSnapshot=new Map();
const contextLayers=()=>data.layers.filter(l=>l.id.startsWith('env.')&&l.id!=='env.site');
let walk=false,yaw=0,pitch=0,walker=[8.8,-6.8],walkDrag=null,joystickVector=[0,0],joystickPointer=null;
const keys=new Set(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
raycaster.params.Line.threshold=.04;
const clipPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),sliceHeight);
let toastTimer,resizeObserver,labelItems=[],framingFactor=1;
const target=new THREE.Vector3(5.3,1.4,-5.8);

function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function setLayer(id,visible){const layer=layers.get(id);if(layer)layer.visible=visible;updateLayerUI();}
function applyVariant(){
  for(const e of data.elements){const o=elementObjects.get(e.id);if(o)o.visible=elementInVariant(e,activeVariant)&&!hiddenElements.has(e.id);}
  data.activeVariant=activeVariant;
}
function setVariant(id){
  activeVariant=variantById(data,id).id;applyVariant();
  for(const l of data.layers.filter(l=>l.variant))layers.get(l.id).visible=l.variant===activeVariant && l.defaultVisible;
  if(activeView==='frame')setView('frame');else{updateLayerUI();viewUI();}
  $('selection').hidden=true;selected=null;
  for(const input of document.querySelectorAll('input[name="construction-variant"]'))input.checked=input.value===activeVariant;
  const url=new URL(location.href);url.searchParams.set('variant',activeVariant);history.replaceState(null,'',url);
}
function variantPanel(){
  for(const v of data.variants.options){
    const label=document.createElement('label');const input=document.createElement('input');input.type='radio';input.name='construction-variant';input.value=v.id;input.checked=v.id===activeVariant;
    input.addEventListener('change',()=>setVariant(v.id));
    const span=document.createElement('span');span.innerHTML=`<strong>${escape(v.name)}</strong><small>${escape(v.subtitle)}</small>`;label.append(input,span);$('variant-options').append(label);
  }
}
function catalogPanel(){
  for(const c of [...data.catalog].sort((a,b)=>a.code.localeCompare(b.code,'ru',{numeric:true}))){
    const b=document.createElement('button');b.className='catalog-item';
    b.innerHTML=`<span class="catalog-code">${escape(c.code)}</span><span><strong>${escape(c.name)}</strong><small>${escape([c.manufacturer,c.model].filter(Boolean).join(' ')) || 'Тип по ТХ'}</small><small>${c.quantity} шт. · размещено ${c.placedIds.length}${c.unplacedQuantity?' · без размещения '+c.unplacedQuantity:''}</small></span>`;
    b.addEventListener('click',()=>{
      if(c.placedIds.length){
        setView('interior');for(const id of c.placedIds){const e=metadata.get(id);setLayer(e.layer,true);hiddenElements.delete(id);}applyVariant();chooseElement(c.placedIds[0]);focusSelected();
      }else{
        selected=null;$('selection-content').innerHTML=`<p class="eyebrow">Каталог ТХ · ${escape(c.code)}</p><h2>${escape(c.name)}</h2><p class="property"><span>Количество по спецификации</span>${c.quantity} шт.</p><p class="property">Оставлено без размещения до уточнения плана.</p>`;$('selection').hidden=false;$('hide-selection').disabled=true;$('focus-selection').disabled=true;
      }
      document.body.classList.remove('panel-open');
    });$('catalog-list').append(b);
  }
}
function updateLayerUI(){
  if(!data)return;
  updateContextButtons();
  syncCoordination();refreshFacadeLights();
  const finished=!!layers.get('design.exterior')?.visible;
  for(const paint of finishPaints){
    const p=data.materials[finished?paint.finish:paint.source];
    paint.material.color.set(p.color);paint.material.roughness=p.roughness??.8;paint.material.metalness=p.metalness??0;
  }
  for(const input of document.querySelectorAll('input[data-layer]'))input.checked=!!layers.get(input.dataset.layer)?.visible;
  for(const input of document.querySelectorAll('input[data-group]')){
    const group=data.layers.filter(l=>l.group===input.dataset.group && (!l.variant || l.variant===activeVariant));
    const n=group.filter(l=>layers.get(l.id)?.visible).length;
    input.checked=n===group.length;input.indeterminate=n>0&&n<group.length;
  }
  for(const row of document.querySelectorAll('[data-layer-row]')){
    const l=data.layers.find(l=>l.id===row.dataset.layerRow);row.hidden=!!l.variant&&l.variant!==activeVariant;
    row.querySelector('.layer-count').textContent=data.elements.filter(e=>e.layer===l.id&&elementInVariant(e,activeVariant)).length;
  }
  $('engineering-legend').hidden=!['em.points','vk.water','vk.sewage'].some(id=>layers.get(id)?.visible);
  for(const [i,id] of ['em.points','vk.water','vk.sewage'].entries())$('engineering-legend').children[i].hidden=!layers.get(id)?.visible;
  const count=data.elements.filter(e=>elementInVariant(e,activeVariant)&&layers.get(e.layer)?.visible&&!hiddenElements.has(e.id)).length;
  $('visible-count').textContent=count+' элементов на экране';
}
function updateContextButtons(){
  const ids=contextLayers(),count=ids.filter(l=>layers.get(l.id)?.visible).length;
  if(count)contextMuted=false;
  const toggle=$('context-toggle');toggle.setAttribute('aria-pressed',String(count>0));
  toggle.classList.toggle('active',count>0);toggle.dataset.partial=String(count>0&&count<ids.length);
  toggle.title=count?'Скрыть окружение; выбранные слои сохранятся':'Показать окружение';
  const motion=$('animation-toggle');motion.setAttribute('aria-pressed',String(animationEnabled));
  motion.classList.toggle('active',animationEnabled);motion.textContent=animationEnabled?'Ⅱ Анимация':'▷ Анимация';
  motion.disabled=!['env.sky','env.traffic'].some(id=>layers.get(id)?.visible);
  motion.title=motion.disabled?'Покажите небо или транспорт, чтобы включить движение':animationEnabled?'Остановить движение; силуэты останутся видимыми':'Включить движение облаков, птиц и машины';
}
function toggleContext(){
  const ids=contextLayers();
  if(ids.some(l=>layers.get(l.id).visible)){
    contextSnapshot=new Map(ids.map(l=>[l.id,layers.get(l.id).visible]));contextMuted=true;
    for(const l of ids)layers.get(l.id).visible=false;
  }else{
    contextMuted=false;
    for(const l of ids)layers.get(l.id).visible=contextSnapshot.has(l.id)?contextSnapshot.get(l.id):l.defaultVisible;
  }
  updateLayerUI();
}
function syncCoordination(){
  const enabled=!!layers.get('coordination.window')?.visible;
  for(const e of data.elements.filter(e=>e.replaces)){
    const source=metadata.get(e.replaces),o=elementObjects.get(e.replaces);
    if(o)o.visible=elementInVariant(source,activeVariant)&&!hiddenElements.has(source.id)&&!enabled;
  }
  for(const e of data.elements.filter(e=>e.followsLayer)){
    const o=elementObjects.get(e.id);if(o)o.visible=elementInVariant(e,activeVariant)&&!!layers.get(e.followsLayer)?.visible&&!hiddenElements.has(e.id)&&(!e.replaces||!hiddenElements.has(e.replaces));
  }
  const note=$('coordination-notice');if(note)note.textContent=activeView==='site'?'Окружение по ЦММ · высоты и озеленение условные':enabled?'Каркас у окна — временная увязка · ожидается Direct Invest':'Исходный каркас · показаны пересечения с окном по АГО';
}
function refreshFacadeLights(){
  if(!camera)return;
  const enabled=environmentMode==='evening'&&!!layers.get('em.lighting')?.visible;
  for(const f of facadeFixtures)f.object.traverse(o=>{if(o.isSpotLight)o.visible=false;});
  if(!enabled)return;
  const cp=camera.position;
  const ranked=facadeFixtures.filter(f=>f.object.visible).map(f=>{
    const p=new THREE.Vector3().setFromMatrixPosition(f.object.matrixWorld),n=new THREE.Vector3(0,0,1).applyQuaternion(f.object.quaternion);
    const toward=cp.clone().sub(p);return {f,score:toward.lengthSq()+(n.dot(toward.normalize())<0?10000:0)};
  }).sort((a,b)=>a.score-b.score);
  // Keep sixteen directional lights active for predictable desktop/mobile rendering.
  for(const {f} of ranked.slice(0,8))f.object.traverse(o=>{if(o.isSpotLight){o.visible=true;o.intensity=f.intensity;}});
}
function setEnvironment(mode){
  environmentMode=mode==='evening'?'evening':'day';const night=environmentMode==='evening';
  if(environmentLights){environmentLights.hemi.intensity=night?.42:2.7;environmentLights.sun.intensity=night?.10:3.1;environmentLights.fill.intensity=night?.24:1.1;}
  scene.background.set(night?'#182331':'#e4e6de');renderer.toneMappingExposure=night?1.22:1.18;
  model.traverse(o=>{if(o.isMesh&&o.material?.name==='fixture_emitter')o.material.emissiveIntensity=night?3.0:.06;});
  document.body.dataset.environment=environmentMode;
  const toggle=$('environment-mode');
  toggle.textContent=night?'☀ День':'☾ Вечер';
  toggle.setAttribute('aria-label',night?'Включить дневной режим':'Включить вечерний режим');
  toggle.title=night?'Сейчас вечер. Переключить на день':'Сейчас день. Переключить на вечер';
  model.traverse(o=>{
    if(o.userData.skyMode)o.visible=o.userData.skyMode===environmentMode;
    if(o.userData.sceneryInk)o.material.color.set(night?'#a9bfcc':'#6c8797');
  });
  refreshFacadeLights();
}
function setSlice(enabled,height=sliceHeight){
  sliceActive=enabled;sliceHeight=height;clipPlane.constant=height;
  renderer.clippingPlanes=[];
  model?.traverse(o=>{if(o.isMesh||o.isLine){const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials){m.clippingPlanes=enabled?[clipPlane]:[];m.clipShadows=true;}}});
  $('slice-enabled').checked=enabled;$('slice').value=height;
  $('slice-value').value=number(height)+' м';
}
function layerPanel(){
  const grouped=new Map();
  for(const l of data.layers){if(!grouped.has(l.group))grouped.set(l.group,[]);grouped.get(l.group).push(l);}
  for(const [name,items] of grouped){
    const details=document.createElement('details');details.className='layer-group';details.open=['Архитектура','Отделка','Технология','Инженерные разделы'].includes(name);
    const summary=document.createElement('summary');
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.group=name;checkbox.setAttribute('aria-label',name+': все слои');
    checkbox.addEventListener('click',event=>event.stopPropagation());
    checkbox.addEventListener('change',()=>{for(const l of items)if(!l.variant || l.variant===activeVariant)layers.get(l.id).visible=checkbox.checked;updateLayerUI();});
    summary.append(checkbox,document.createTextNode(name));details.append(summary);
    for(const l of items){
      const label=document.createElement('label');label.className='layer-row';label.dataset.layerRow=l.id;label.title=l.description || l.name;
      const input=document.createElement('input');input.type='checkbox';input.dataset.layer=l.id;input.setAttribute('aria-label',l.name);
      input.addEventListener('change',()=>setLayer(l.id,input.checked));
      const span=document.createElement('span');span.textContent=l.name;
      const count=document.createElement('span');count.className='layer-count';count.textContent=data.elements.filter(e=>e.layer===l.id).length;
      label.append(input,span,count);details.append(label);
    }
    $('layer-list').append(details);
  }
  updateLayerUI();
}
function roomPanel(){
  const labels=document.createElement('div');labels.className='room-labels';$('viewport').append(labels);
  for(const [i,r] of data.rooms.entries()){
    const button=document.createElement('button');button.className='room-button';button.innerHTML=`<span>${String(i+1).padStart(2,'0')}</span><span>${escape(r.name)}</span><span>${number(r.area)} м²</span>`;
    button.addEventListener('click',()=>chooseRoom(r));$('room-list').append(button);
    const label=document.createElement('button');label.className='room-label';label.dataset.roomNumber=String(i+1).padStart(2,'0');label.title=r.name;label.setAttribute('aria-label',r.name);label.innerHTML=escape(r.name)+`<small>${number(r.area)} м²</small>`;
    label.addEventListener('click',()=>chooseRoom(r));labels.append(label);labelItems.push({room:r,element:label});
  }
}
function updateLabels(){
  const w=$('viewport').clientWidth,h=$('viewport').clientHeight;
  for(const {room:r,element:el} of labelItems){
    if(!['plan','interior','engineering'].includes(activeView)||walk||!layers.get('ar.floors').visible){el.hidden=true;continue;}
    const p=new THREE.Vector3(r.focus[0],r.height+.035,r.focus[2]).project(camera);
    el.hidden=p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;
    const compact=r.area<12;
    if(el.dataset.compact!==String(compact)){
      el.dataset.compact=String(compact);el.innerHTML=(compact?el.dataset.roomNumber:escape(r.name))+`<small>${number(r.area)} м²</small>`;
    }
    el.style.left=(p.x*.5+.5)*w+'px';el.style.top=(-p.y*.5+.5)*h+'px';
  }
}
function cameraView(position,lookAt,useOrtho=false){
  controls.dispose();camera=useOrtho?orthographic:perspective;
  camera.position.fromArray(position);camera.up.set(0,1,0);
  if(!useOrtho&&!walk){const aspect=$('viewport').clientWidth/$('viewport').clientHeight;framingFactor=Math.max(1,.82/aspect);const focus=new THREE.Vector3().fromArray(lookAt);camera.position.sub(focus).multiplyScalar(framingFactor).add(focus);}
  if(useOrtho){camera.up.set(0,0,-1);camera.zoom=1;}
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.085;
  controls.minDistance=1;controls.maxDistance=activeView==='site'?350:65;controls.maxPolarAngle=Math.PI/2-.015;
  controls.target.fromArray(lookAt);controls.enableRotate=!useOrtho;controls.update();resize();
}
function defaultLayers(){for(const l of data.layers)layers.get(l.id).visible=l.defaultVisible&&(!l.variant||l.variant===activeVariant)&&!(contextMuted&&l.id.startsWith('env.')&&l.id!=='env.site');applyVariant();updateLayerUI();}
function setView(view){
  if(view==='walk'){startWalk($('walk-start').value || 'hall');return;}
  if(walk)exitWalk(false);
  activeView=view;defaultLayers();
  perspective.far=view==='site'?400:200;perspective.updateProjectionMatrix();
  if(view==='overview'){
    setSlice(false);cameraView([-17,12.5,15],[4.8,1.8,-5]);
  }else if(view==='site'){
    setSlice(false);cameraView([-48,79,74],[30,1,-12]);
    const section=document.querySelector('input[data-group="Окружение"]')?.closest('details');
    if(section){section.open=true;if(matchMedia('(min-width:851px)').matches)section.scrollIntoView({block:'nearest'});}
  }else if(view==='plan'){
    setSlice(true,1.6);cameraView([5.3,28,-7.08],[5.3,0,-7.08],true);
  }else if(view==='interior'){
    for(const id of ['ar.roof.core','ar.roof.inner','ar.roof.outer','ar.ceiling'])layers.get(id).visible=false;
    setSlice(true,2.65);cameraView([17,12,7],[5.3,1,-5.3]);
  }else if(view==='frame'){
    for(const l of data.layers)layers.get(l.id).visible=[...variantById(data,activeVariant).frameLayers,'coordination.window','ar.floors','env.site'].includes(l.id);
    setSlice(false);cameraView([21,16,17],[5.3,2,-5.3]);
  }else if(view==='engineering'){
    for(const id of ['ar.roof.core','ar.roof.inner','ar.roof.outer','ar.ceiling','ar.canopy','ar.walls.outer','ar.walls.inner','design.exterior','design.signage','design.displays','design.reveals','design.soffit','em.lighting'])layers.get(id).visible=false;
    for(const id of ['em.points','vk.water','vk.sewage'])layers.get(id).visible=true;
    setSlice(true,2.7);cameraView([17,15,7],[5.3,1,-5.3]);
  }
  viewUI();updateLayerUI();$('selection').hidden=true;selected=null;
}
function viewUI(){
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===activeView);b.setAttribute('aria-pressed',String(b.dataset.view===activeView));});
  const titles={overview:'Общий вид',site:'Участок / чертёжное окружение',plan:'План / срез '+number(sliceHeight)+' м',interior:'Интерьер / открытая модель',frame:'Каркас',engineering:'Точки подключения ТХ',walk:'Прогулка внутри проекта'};
  titles[activeView]+=' · '+variantById(data,activeVariant).name;
  $('view-label').innerHTML='<span class="live-dot"></span>'+titles[activeView];
  $('walk-ui').hidden=!walk;
  $('hint').textContent=walk?'WASD / стрелки: идти · потяните мышью: осмотр · Esc: выйти':matchMedia('(pointer:coarse)').matches?'Один палец: вращение · два: масштаб и сдвиг':'Мышь: вращение · колесо: масштаб · правая кнопка: сдвиг';
}
function chooseRoom(r){
  if(walk)exitWalk(false);
  if(!['plan','interior','engineering'].includes(activeView))setView('interior');
  const pts=r.points;const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);
  const x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2;
  const d=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs),2.8);
  if(camera===orthographic){cameraView([x,28,z],[x,0,z],true);camera.zoom=Math.max(1,14/d);camera.updateProjectionMatrix();}
  else cameraView([x+d*.7,d*.8+2,z+d*.8],[x,.7,z]);
  selected={room:r};$('selection-content').innerHTML=`<p class="eyebrow">Помещение / АР</p><h2>${escape(r.name)}</h2><p class="property"><span>Площадь по экспликации АР</span>${number(r.area)} м²</p><p class="property"><span>Уровень пола</span>${number(r.height)} м</p>`;
  $('selection').hidden=false;$('hide-selection').disabled=true;document.body.classList.remove('panel-open');
  $('focus-selection').disabled=false;
}
function chooseElement(id){
  const e=metadata.get(id);if(!e)return;selected={id};
  const layer=data.layers.find(l=>l.id===e.layer);
  const badges={schematic:'Условно / для визуализации',reference:'Предварительная модель КМ',graphic:'Графическая привязка'};
  $('selection-content').innerHTML=`<p class="eyebrow">${escape(layer.name)}</p><h2>${escape(e.name)}</h2>`+
    (badges[e.status]?`<span class="status-badge">${badges[e.status]}</span>`:'')+
    Object.entries(e.properties).map(([key,val])=>`<p class="property"><span>${escape(key)}</span>${escape(val)}</p>`).join('')+
    `<p class="property"><span>Элемент / источник</span>${escape(e.id)} · ${escape(e.sources.join(', '))}</p>`;
  $('selection').hidden=false;$('hide-selection').disabled=false;
  $('focus-selection').disabled=false;
}
function pick(event){
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const pickables=[];model.traverseVisible(o=>{if(o.isMesh)pickables.push(o);});
  const hits=raycaster.intersectObjects(pickables,false);
  for(const hit of hits){
    if(sliceActive&&hit.point.y>sliceHeight+.001)continue;
    let o=hit.object;while(o&&!o.userData.elementId)o=o.parent;
    if(o?.userData.elementId){chooseElement(o.userData.elementId);return;}
  }
  $('selection').hidden=true;selected=null;
}
function focusSelected(){
  if(!selected)return;if(selected.room){chooseRoom(selected.room);return;}
  if(walk)exitWalk(false);
  const o=elementObjects.get(selected.id);const b=new THREE.Box3().setFromObject(o);const p=b.getCenter(new THREE.Vector3());const d=Math.max(b.getSize(new THREE.Vector3()).length(),1.6);
  const room=data.rooms.find(r=>inPolygon(p.x,p.z,r.points));
  let dx=.7,dz=.8;
  if(room){const x=room.focus[0]-p.x,z=room.focus[2]-p.z,len=Math.hypot(x,z);if(len>.1){dx=x/len;dz=z/len;}}
  if(activeView==='interior')setSlice(true,Math.min(5.2,Math.max(1.2,b.max.y+.12)));
  cameraView([p.x+d*dx,Math.max(p.y+d*.95,sliceActive?sliceHeight+.8:0),p.z+d*dz],p.toArray());
}
function startWalk(id){
  const start=data.walk.starts.find(s=>s.id===id)||data.walk.starts[0];
  if(walkBlocked(start.position[0],start.position[2],data)){toast('Начальная точка занята. Выберите другую точку прогулки.');return;}
  walk=true;document.body.classList.add('is-walking');activeView='walk';defaultLayers();setSlice(false);$('selection').hidden=true;selected=null;
  cameraView(start.position,[start.position[0],start.position[1],start.position[2]-1]);
  controls.enabled=false;camera=perspective;walker=[start.position[0],start.position[2]];yaw=start.yaw;pitch=0;
  $('walk-start').value=start.id;document.body.classList.remove('panel-open');viewUI();resize();
}
function exitWalk(reset=true){
  walk=false;document.body.classList.remove('is-walking');keys.clear();joystickVector=[0,0];walkDrag=null;controls.enabled=true;$('walk-ui').hidden=true;
  if(reset)setView('overview');else{activeView='interior';viewUI();}
}
function updateWalk(dt){
  let forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-joystickVector[1];
  let side=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joystickVector[0];
  const length=Math.hypot(forward,side);if(length>1){forward/=length;side/=length;}
  const speed=(keys.has('ShiftLeft')?2.8:1.7)*dt;
  const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed;
  const dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*speed;
  const next=moveWalker(walker,dx,dz,data,data.walk.radius);walker=[next[0],next[1]];
  camera.position.set(walker[0],(next[2]??0)+data.walk.eyeHeight,walker[1]);camera.rotation.set(pitch,yaw,0,'YXZ');
}
function resize(){
  if(!renderer)return;const w=$('viewport').clientWidth,h=$('viewport').clientHeight;
  renderer.setSize(w,h);perspective.aspect=w/h;perspective.updateProjectionMatrix();
  if(camera===perspective&&!walk&&controls){const factor=Math.max(1,.82/(w/h));camera.position.sub(controls.target).multiplyScalar(factor/framingFactor).add(controls.target);framingFactor=factor;}
  const size=Math.max(25.2,14.5*h/w);orthographic.left=-size*w/h/2;orthographic.right=size*w/h/2;orthographic.top=size/2;orthographic.bottom=-size/2;orthographic.updateProjectionMatrix();
}
function events(){
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{setView(b.dataset.view);document.body.classList.remove('panel-open');}));
  for(const id of ['panel-button','close-panel'])$(id).addEventListener('click',()=>document.body.classList.toggle('panel-open'));
  document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('[data-panel]').forEach(n=>n.classList.toggle('active',n===b));
    $('layers-panel').hidden=b.dataset.panel!=='layers';$('rooms-panel').hidden=b.dataset.panel!=='rooms';$('catalog-panel').hidden=b.dataset.panel!=='catalog';
  }));
  $('restore-layers').addEventListener('click',()=>{hiddenElements.clear();defaultLayers();$('restore-elements').hidden=true;updateLayerUI();});
  $('slice-enabled').addEventListener('change',()=>{if(walk)exitWalk(false);setSlice($('slice-enabled').checked);});
  $('slice').addEventListener('input',()=>{if(walk)exitWalk(false);setSlice(true,Number($('slice').value));if(activeView==='plan')viewUI();});
  $('home-button').addEventListener('click',()=>setView('overview'));
  $('context-toggle').addEventListener('click',toggleContext);
  $('animation-toggle').addEventListener('click',()=>{animationEnabled=!animationEnabled;updateContextButtons();});
  $('facade-view').addEventListener('change',()=>{
    const value=$('facade-view').value;if(!value)return;setView('overview');
    const views={front:[[5.3,7,26],[5.3,2,-.5]],rear:[[5.3,12,-34],[5.3,1.5,-10.5]],left:[[-24,9,-6],[5.3,2,-6]],right:[[34,9,-6],[5.3,2,-6]]};
    cameraView(...views[value]);$('view-label').textContent=$('facade-view').selectedOptions[0].textContent;
  });
  $('close-selection').addEventListener('click',()=>$('selection').hidden=true);
  $('focus-selection').addEventListener('click',focusSelected);
  $('hide-selection').addEventListener('click',()=>{if(!selected?.id)return;elementObjects.get(selected.id).visible=false;hiddenElements.add(selected.id);$('selection').hidden=true;$('restore-elements').hidden=false;updateLayerUI();toast('Элемент скрыт. «Сбросить» вернёт все элементы.');});
  $('restore-elements').addEventListener('click',()=>{hiddenElements.clear();applyVariant();$('restore-elements').hidden=true;updateLayerUI();});
  $('about-button').addEventListener('click',()=>$('about-dialog').showModal());
  document.querySelectorAll('dialog').forEach(d=>{d.querySelector('.dialog-close').addEventListener('click',()=>d.close());d.addEventListener('click',event=>{if(event.target===d){const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)d.close();}});});
  $('fullscreen-button').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Полный экран недоступен в этом браузере.');}});
  $('png-button').addEventListener('click',()=>{
    const w=$('viewport').clientWidth,h=$('viewport').clientHeight;const width=Math.max(1920,w),height=Math.round(width*h/w);const pixelRatio=renderer.getPixelRatio();
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.render(scene,camera);
    const url=renderer.domElement.toDataURL('image/png');renderer.setPixelRatio(pixelRatio);renderer.setSize(w,h,false);
    const a=document.createElement('a');a.href=url;a.download='cafe-'+data.revision+'-'+activeView+'.png';a.click();toast('PNG сохранён: '+width+' × '+height);
  });
  $('walk-start').addEventListener('change',()=>startWalk($('walk-start').value));$('exit-walk').addEventListener('click',()=>exitWalk());
  let down=null;
  renderer.domElement.addEventListener('pointerdown',event=>{
    down={x:event.clientX,y:event.clientY,t:performance.now()};
    if(walk){walkDrag={id:event.pointerId,x:event.clientX,y:event.clientY};renderer.domElement.setPointerCapture(event.pointerId);}
  });
  renderer.domElement.addEventListener('pointermove',event=>{
    if(walk&&walkDrag?.id===event.pointerId){yaw-=(event.clientX-walkDrag.x)*.004;pitch-= (event.clientY-walkDrag.y)*.003;pitch=Math.max(-1.3,Math.min(1.3,pitch));walkDrag.x=event.clientX;walkDrag.y=event.clientY;}
  });
  renderer.domElement.addEventListener('pointerup',event=>{if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<5&&performance.now()-down.t<450)pick(event);down=null;walkDrag=null;});
  renderer.domElement.addEventListener('pointercancel',()=>{down=null;walkDrag=null;});
  window.addEventListener('keydown',event=>{
    if(!walk||['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;
    if(event.code==='Escape'){exitWalk();return;}
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft'].includes(event.code)){keys.add(event.code);event.preventDefault();}
  });
  window.addEventListener('keyup',event=>keys.delete(event.code));window.addEventListener('blur',()=>{keys.clear();joystickVector=[0,0];});
  const joy=$('joystick'),knob=$('joystick-knob');
  const updateJoy=event=>{const r=joy.getBoundingClientRect(),dx=event.clientX-r.left-r.width/2,dy=event.clientY-r.top-r.height/2,limit=r.width*.33,length=Math.hypot(dx,dy),f=length>limit?limit/length:1;joystickVector=[dx*f/limit,dy*f/limit];knob.style.transform=`translate(${dx*f}px,${dy*f}px)`;};
  joy.addEventListener('pointerdown',event=>{joystickPointer=event.pointerId;joy.setPointerCapture(event.pointerId);updateJoy(event);});
  joy.addEventListener('pointermove',event=>{if(event.pointerId===joystickPointer)updateJoy(event);});
  const clearJoy=()=>{joystickPointer=null;joystickVector=[0,0];knob.style.transform='';};joy.addEventListener('pointerup',clearJoy);joy.addEventListener('pointercancel',clearJoy);
  resizeObserver=new ResizeObserver(resize);resizeObserver.observe($('viewport'));
}

async function init(){
  data=await fetch('./model/canonical.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Данные модели недоступны');return r.json();});
  activeVariant=variantById(data,new URLSearchParams(location.search).get('variant')).id;data.activeVariant=activeVariant;
  $('revision').textContent=data.revision+' · '+data.date.split('-').reverse().join('.');
  for(const e of data.elements)metadata.set(e.id,e);
  renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.8));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.localClippingEnabled=true;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  $('canvas-host').append(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D-вид здания кафе');renderer.domElement.tabIndex=0;
  scene=new THREE.Scene();scene.background=new THREE.Color('#e4e6de');
  const hemi=new THREE.HemisphereLight('#fff8e8','#c1cebd',2.7);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff5e2',3.1);sun.position.set(-9,19,12);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0006;sun.shadow.normalBias=.035;sun.shadow.camera.left=-20;sun.shadow.camera.right=20;sun.shadow.camera.top=20;sun.shadow.camera.bottom=-20;sun.shadow.camera.far=60;sun.target.position.set(5,0,-6);scene.add(sun,sun.target);
  const fill=new THREE.DirectionalLight('#dae8ef',1.1);fill.position.set(15,10,-15);scene.add(fill);
  environmentLights={hemi,sun,fill};
  perspective=new THREE.PerspectiveCamera(43,1,.04,200);orthographic=new THREE.OrthographicCamera(-10,10,10,-10,.04,200);camera=perspective;
  controls=new OrbitControls(camera,renderer.domElement);
  const gltf=await new GLTFLoader().loadAsync('./assets/cafe.glb?v='+encodeURIComponent(data.build||(data.revision+'-'+data.date)),progress=>{if(progress.total)$('loading-progress').style.width=Math.round(progress.loaded/progress.total*100)+'%';});
  model=gltf.scene;model.traverse(o=>{
    if(o.userData.layerId&&!o.userData.elementId)layers.set(o.userData.layerId,o);
    if(o.userData.elementId)elementObjects.set(o.userData.elementId,o);
    if(o.isMesh){o.castShadow=!o.userData.context&&!o.material.transparent&&metadata.get(o.parent?.userData.elementId)?.geometry.type!=='indexedMesh';o.receiveShadow=!o.userData.context;}
  });
  if(layers.size!==data.layers.length||elementObjects.size!==data.elements.length)throw new Error('Состав GLB не совпадает с описанием модели');
  for(const e of data.elements.filter(e=>e.finishMaterial))elementObjects.get(e.id).traverse(o=>{
    if(o.isMesh){o.material=o.material.clone();finishPaints.push({material:o.material,source:e.material,finish:e.finishMaterial});}
  });
  scene.add(model);
  sceneryMotion=createSceneryMotion(model);
  facadeFixtures=data.elements.filter(e=>e.geometry.type==='upDownLight').map(e=>({object:elementObjects.get(e.id),intensity:e.geometry.intensity}));
  $('about-content').innerHTML='<ul>'+data.limits.map(t=>'<li>'+escape(t)+'</li>').join('')+'</ul>';
  for(const start of data.walk.starts){const option=document.createElement('option');option.value=start.id;option.textContent=start.name;$('walk-start').append(option);}
  applyVariant();variantPanel();layerPanel();roomPanel();catalogPanel();events();
  $('environment-mode').addEventListener('click',()=>setEnvironment(environmentMode==='evening'?'day':'evening'));
  setEnvironment(new URLSearchParams(location.search).get('light')==='day'?'day':'evening');
  const query=new URLSearchParams(location.search);const view=query.get('view');setView(['site','plan','interior','engineering','frame','walk'].includes(view)?view:'overview');
  $('loading').hidden=true;
  let last=performance.now();
  const perf=query.has('perf')?{signature:'',warmup:0,samples:[],logged:false}:null;
  if(perf){const output=document.createElement('output');output.id='performance-readout';output.setAttribute('aria-label','Проверка производительности');output.className='performance-readout';output.textContent='Замер производительности…';$('viewport').append(output);}
  renderer.setAnimationLoop(time=>{
    const frameStart=performance.now(),interval=time-last,dt=Math.min(interval/1000,.05);last=time;
    if(walk)updateWalk(dt);else controls.update();if(time-lastLightUpdate>200){refreshFacadeLights();lastLightUpdate=time;}
    const motionStart=performance.now();
    sceneryMotion.update(dt,animationEnabled&&!document.hidden);
    const motionMs=performance.now()-motionStart;
    renderer.render(scene,camera);updateLabels();
    if(perf){
      const context=data.layers.filter(l=>l.id.startsWith('env.')&&l.id!=='env.site'&&layers.get(l.id).visible).map(l=>l.id);
      const signature=activeView+'|'+environmentMode+'|'+animationEnabled+'|'+context.join(',');if(signature!==perf.signature){Object.assign(perf,{signature,warmup:0,samples:[],logged:false});$('performance-readout').textContent='Замер производительности…';}
      if(!perf.logged)$('performance-readout').textContent='Замер производительности: '+perf.samples.length+' / 30 кадров';
      if(perf.warmup++>5&&!perf.logged){perf.samples.push([interval,performance.now()-frameStart,motionMs]);if(perf.samples.length===30){
        const percentile=(i,p)=>perf.samples.map(v=>v[i]).sort((a,b)=>a-b)[Math.floor((perf.samples.length-1)*p)];
        const result={view:activeView,light:environmentMode,animation:animationEnabled,context,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,lines:renderer.info.render.lines,medianFrameMs:percentile(0,.5),p95FrameMs:percentile(0,.95),medianCpuMs:percentile(1,.5),medianMotionMs:percentile(2,.5),width:$('viewport').clientWidth,height:$('viewport').clientHeight,pixelRatio:renderer.getPixelRatio()};
        console.info('CAFE_PERF '+JSON.stringify(result));
        $('performance-readout').textContent=JSON.stringify(result);perf.logged=true;
      }}
    }
  });
}
init().catch(error=>{
  console.error(error);$('loading-status').textContent='Не удалось открыть 3D: '+error.message+'. Скачайте GLB через «О модели» или откройте страницу в браузере с WebGL.';
  $('loading').querySelector('strong').textContent='Модель не загрузилась';
  const a=document.createElement('a');a.href='./assets/cafe.glb';a.textContent='Скачать GLB';$('loading').append(a);
});

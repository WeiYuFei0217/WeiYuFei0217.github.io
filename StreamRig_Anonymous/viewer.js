'use strict';
// StreamRig 主页 3D 建图查看器：多数据集逐 rig 点云累积（深色舞台 + 跟随 rig 的局部地面 + 离地高度着色）。
// 所有几何来自归档数据（见各数据集 provenance）；地面高度由「点相对观测 rig 的高度」直方图众数估计，不做地形拟合。
// 数据文件按需懒加载：assets/reconstruction.js（NCLT，页面默认）与 assets/map-<key>.js（其余数据集）。
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const VIEW={bg:'#0e1218',azimuth:1.63,elevation:.93,distance:1.12,refSpan:230};
// 各数据集的展示配置；unit 为场景尺度（rig 模型、视锥、网格、跟随距离随之缩放）
const DATASETS={
 nclt:{file:'assets/reconstruction.js',get:()=>window.STREAMRIG_MAP,heightTop:12},
 k360:{file:'assets/map-k360.js',get:()=>window.STREAMRIG_MAPS&&window.STREAMRIG_MAPS.k360,heightTop:15},
 tg:{file:'assets/map-tg.js',get:()=>window.STREAMRIG_MAPS&&window.STREAMRIG_MAPS.tg,heightTop:7,clipAbove:7},
 zjh:{file:'assets/map-zjh.js',get:()=>window.STREAMRIG_MAPS&&window.STREAMRIG_MAPS.zjh,heightTop:3,clipAbove:2.8}
};
// 懒加载资源的内容哈希（由 tools/stamp_versions.py 重写），URL 带 ?v= 防止浏览器沿用旧缓存
const ASSET_VERSION={"reconstruction.js":"653729e752","map-k360.js":"1a92724080","map-tg.js":"fd08cc8093","map-zjh.js":"39012c9d29","k360-inputs.jpg":"2d49e0255b","nclt-inputs.jpg":"7e85fdcebe","tg-inputs.jpg":"caf1d42f53","zjh-inputs.jpg":"ab909a7ea3"};
const versioned=url=>{const v=ASSET_VERSION[url.split('/').pop()];return v?`${url}?v=${v}`:url};
const loaded={};
function loadDataset(key){const cfg=DATASETS[key];if(cfg.get())return Promise.resolve(cfg.get());
 if(!loaded[key])loaded[key]=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=versioned(cfg.file);s.onload=()=>cfg.get()?resolve(cfg.get()):reject(Error('empty '+key));s.onerror=()=>reject(Error('failed '+cfg.file));document.head.append(s)});
 return loaded[key]}
function decodeArray(value,Type){const str=atob(value),bytes=new Uint8Array(str.length);for(let i=0;i<str.length;i++)bytes[i]=str.charCodeAt(i);return new Type(bytes.buffer)}
// sRGB→线性；若图像整体很暗（p90 亮度 < 0.08，例如 NCLT），RGB 模式仅在显示层做按亮度的指数曝光（保持色相），存档 RGB 不变
function displayColors(rgb){const colors=new Float32Array(rgb.length);for(let i=0;i<rgb.length;i++){const s=rgb[i]/255;colors[i]=s<=.04045?s/12.92:Math.pow((s+.055)/1.055,2.4)}
 const n=colors.length/3,luma=new Float32Array(n);for(let i=0;i<n;i++)luma[i]=.2126*colors[3*i]+.7152*colors[3*i+1]+.0722*colors[3*i+2];
 const sample=Float32Array.from({length:4000},(_,k)=>luma[Math.floor(k*n/4000)]).sort(),p90=sample[Math.floor(.9*sample.length)];
 if(p90<.08){const gain=1/(3.5*Math.max(p90,1e-4));for(let i=0;i<n;i++){const L=Math.max(luma[i],1e-6),scale=(1-Math.exp(-gain*L))/L;for(let k=0;k<3;k++)colors[3*i+k]=Math.min(1,colors[3*i+k]*scale)}}
 return {colors,exposed:p90<.08}}
// 每个点对应的位姿索引（frameIds 可能按 2 帧采样）
function poseIndexFor(frames,ids){const out=new Uint16Array(frames.length);for(let i=0;i<frames.length;i++){let lo=0,hi=ids.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(ids[mid]<=frames[i])lo=mid;else hi=mid-1}out[i]=lo}return out}
// 地面相对 rig 的高度偏移：rig 周围水平环内点的 Δy 直方图众数（0.1 m 分箱）
function groundOffset(positions,poses,poseIndex,ring){const bins=new Uint32Array(80);for(let i=0;i<poseIndex.length;i+=3){const p=poses[poseIndex[i]];const d=Math.hypot(positions[3*i]-p[0][3],positions[3*i+2]-p[2][3]);if(d<ring[0]||d>ring[1])continue;const b=Math.floor((positions[3*i+1]-p[1][3]+4)/.1);if(b>=0&&b<80)bins[b]++}
 // 地面 = 自下而上第一个达到峰值一半的分箱附近（其上 0.4 m 内的局部最大）；室内地面点稀少时不会被桌面等物体的众数带偏
 let peak=0;for(let b=1;b<80;b++)if(bins[b]>bins[peak])peak=b;let onset=0;while(bins[onset]<.5*bins[peak])onset++;
 let best=onset;for(let b=onset;b<=Math.min(79,onset+4);b++)if(bins[b]>bins[best])best=b;return -4+best*.1+.05}
function heightAboveGround(positions,poses,poseIndex,offset){const h=new Float32Array(poseIndex.length);for(let i=0;i<h.length;i++)h[i]=positions[3*i+1]-(poses[poseIndex[i]][1][3]+offset);return h}
// 稳健包围盒：按 1%–99% 分位数取中心与水平跨度，避免稀疏离群点把默认视角拉得过远
function robustBounds(positions,center){const n=positions.length/3,step=Math.max(1,Math.floor(n/20000)),axes=[[],[],[]];for(let i=0;i<n;i+=step)for(let k=0;k<3;k++)axes[k].push(positions[3*i+k]);
 const q=axes.map(a=>{a.sort((x,y)=>x-y);return [a[Math.floor(.01*a.length)],a[Math.floor(.99*a.length)]]});center.set((q[0][0]+q[0][1])/2,(q[1][0]+q[1][1])/2,(q[2][0]+q[2][1])/2);return Math.max(q[0][1]-q[0][0],q[2][1]-q[2][0])}
function niceStep(x){for(const s of [1,2,5,10,20])if(s>=x)return s;return 20}

function startMap(){
 const {THREE:T,OrbitControls,Line2,LineGeometry,LineMaterial}=window.StreamRigGL;
 const canvas=$('#map-canvas'),stage=$('#map-stage');
 const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(VIEW.bg);renderer.outputColorSpace=T.SRGBColorSpace;
 const scene=new T.Scene();scene.background=new T.Color(VIEW.bg);
 const camera=new T.PerspectiveCamera(40,1,.05,4000);camera.up.set(0,1,0);
 const controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.minPolarAngle=.04;controls.maxPolarAngle=Math.PI/2-.06;controls.screenSpacePanning=false;controls.rotateSpeed=.65;controls.zoomSpeed=.85;
 const uniforms={uFrame:{value:0},uMono:{value:0},uFront:{value:0},uShade:{value:2},uSize:{value:2},uPixelRatio:{value:renderer.getPixelRatio()},uHeightTop:{value:12},uClip:{value:1e9},uRefDist:{value:200},uFogNear:{value:100},uFogFar:{value:500},uBg:{value:new T.Color(VIEW.bg)}};
 const material=new T.ShaderMaterial({uniforms,vertexColors:true,vertexShader:`
 attribute float aFrame; attribute float aCamera; attribute float aHeight;
 uniform float uFrame,uMono,uFront,uShade,uSize,uPixelRatio,uHeightTop,uClip,uRefDist,uFogNear,uFogFar;
 varying vec3 vColor;varying float vVisible;varying float vFog;
 // viridis 0.3–1.0 段（sRGB），深色背景下地面仍可辨
 vec3 ramp(float t){vec3 c0=vec3(.192,.408,.557),c1=vec3(.129,.569,.549),c2=vec3(.208,.718,.475),c3=vec3(.565,.843,.263),c4=vec3(.992,.906,.145);
   t=clamp(t,0.,1.)*4.;vec3 c=t<1.?mix(c0,c1,t):t<2.?mix(c1,c2,t-1.):t<3.?mix(c2,c3,t-2.):mix(c3,c4,t-3.);return pow(c,vec3(2.2));}
 void main(){
   vVisible=(aFrame<=uFrame&&aHeight<uClip&&(uMono<.5||abs(aCamera-uFront)<.5))?1.:0.;
   vec3 hc=ramp(aHeight/uHeightTop);
   vColor=color;
   if(uShade>.5&&uShade<1.5){float nearFrame=1.-smoothstep(2.,8.,uFrame-aFrame);vColor=mix(hc*.16+vec3(.02),vec3(1.,.36,.06),nearFrame);}
   if(uShade>1.5)vColor=hc;
   vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
   float dist=-mv.z;gl_PointSize=uSize*uPixelRatio*clamp(uRefDist/dist,.75,1.7);
   vFog=smoothstep(uFogNear,uFogFar,dist)*.6;
   if(vVisible<.5)gl_Position=vec4(2.,2.,2.,1.);
 }`,fragmentShader:`uniform vec3 uBg;varying vec3 vColor;varying float vVisible;varying float vFog;
 void main(){if(vVisible<.5||length(gl_PointCoord-.5)>.5)discard;gl_FragColor=vec4(mix(vColor,uBg,vFog),1.);
 #include <colorspace_fragment>
 }`,depthTest:true,depthWrite:true});
 // 局部地面：以当前 rig 为中心的圆盘网格（主线/细线，径向淡出），高度 = rig 高度 + 地面偏移；网格线锚定世界坐标
 const groundUniforms={uCenter:{value:new T.Vector2()},uRadius:{value:75},uMajor:{value:10},uMinor:{value:2}};
 const ground=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms:groundUniforms,transparent:true,depthWrite:false,side:T.DoubleSide,vertexShader:`varying vec2 vXZ;void main(){vec4 w=modelMatrix*vec4(position,1.);vXZ=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}`,fragmentShader:`uniform vec2 uCenter;uniform float uRadius,uMajor,uMinor;varying vec2 vXZ;
 float grid(vec2 p,float s){vec2 q=p/s;vec2 g=abs(fract(q-.5)-.5)/fwidth(q);return 1.-min(min(g.x,g.y),1.);}
 void main(){float r=length(vXZ-uCenter)/uRadius;float fade=1.-smoothstep(.35,1.,r);if(fade<=0.)discard;
   float major=grid(vXZ,uMajor),minor=grid(vXZ,uMinor);float a=max(major*.55,minor*.16)*fade+.07*fade;
   vec3 c=mix(vec3(.30,.36,.45),vec3(.58,.66,.78),major);gl_FragColor=vec4(pow(c,vec3(2.2)),a);
 #include <colorspace_fragment>
 }`}));
 ground.rotation.x=-Math.PI/2;ground.renderOrder=-1;scene.add(ground);
 scene.add(new T.HemisphereLight(0xffffff,0x4a5568,2.2));const sun=new T.DirectionalLight(0xffffff,2);sun.position.set(-50,180,70);scene.add(sun);
 const rig=new T.Group();rig.matrixAutoUpdate=false;scene.add(rig);
 const rigBody=new T.Mesh(new T.BoxGeometry(1.5,.7,1.5),new T.MeshStandardMaterial({color:'#ff9a52',roughness:.5,metalness:.1,emissive:'#7a3510'}));rig.add(rigBody);
 // rig 落地标记：地面上的光圈 + 竖直虚线
 const footprint=new T.Mesh(new T.RingGeometry(1.9,2.5,48),new T.MeshBasicMaterial({color:'#ff9a52',transparent:true,opacity:.85,depthWrite:false,side:T.DoubleSide}));footprint.rotation.x=-Math.PI/2;footprint.renderOrder=1;scene.add(footprint);
 const dropGeometry=new T.BufferGeometry().setFromPoints([new T.Vector3(),new T.Vector3()]);const dropMaterial=new T.LineDashedMaterial({color:'#ffb37a',dashSize:.35,gapSize:.25,transparent:true,opacity:.8});const drop=new T.Line(dropGeometry,dropMaterial);scene.add(drop);
 const lineMaterial=new LineMaterial({color:'#e9f1ff',linewidth:2.4,transparent:true,opacity:.95,depthTest:false});let lineGeometry=new LineGeometry();const trajectory=new Line2(lineGeometry,lineMaterial);trajectory.renderOrder=4;scene.add(trajectory);
 const startMarker=new T.Mesh(new T.SphereGeometry(1.1,14,10),new T.MeshBasicMaterial({color:'#e9f1ff'}));scene.add(startMarker);

 // ---- 数据集相关状态（setDataset 重建）----
 let data=null,key='nclt',cfg=DATASETS.nclt,sources=null,counts=null,poseIndex=null,cloud=null,geometry=null,frusta=[],cumulativeMulti=null,cumulativeMono=null;
 let center=new T.Vector3(),span=200,unit=1,gridMajor=10;
 let poseSource='pred',mode='multi',currentFrame=0,playing=false,lastTick=0,visible=true,raf=0,playbackFrame=0,activePathSource=null,follow=false,switching=null;
 const rigPosition=new T.Vector3(),previousRig=new T.Vector3();
 function getPoses(){return sources[poseSource].poses}
 function indexFor(frame){const ids=data.frameIds;let lo=0,hi=ids.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(ids[mid]<=frame)lo=mid;else hi=mid-1}return lo}
 function setPressed(selector,value,property){$$(selector).forEach(b=>b.setAttribute('aria-pressed',b.dataset[property]===value))}
 function setFollow(on){follow=on;$('#map-focus').setAttribute('aria-pressed',on)}
 function buildFrusta(){for(const f of frusta){rig.remove(f);f.geometry.dispose();f.material.dispose()}frusta=[];
  data.extrinsics.forEach((ext,c)=>{const E=new T.Matrix4().fromArray(ext.flat()).transpose(),d=3.6*unit,vertices=[[-d,-d*.75,d],[d,-d*.75,d],[d,d*.75,d],[-d,d*.75,d]],pts=[];for(let i=0;i<4;i++)pts.push(0,0,0,...vertices[i],...vertices[i],...vertices[(i+1)%4]);
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pts,3));const f=new T.LineSegments(g,new T.LineBasicMaterial({color:c===data.frontCamera?'#ff8a3d':'#ffc690',transparent:true,opacity:.95,depthTest:false}));f.matrixAutoUpdate=false;f.matrix.copy(E);f.renderOrder=5;rig.add(f);frusta.push(f)})}
 function setDataset(nextKey,nextData){
  key=nextKey;cfg=DATASETS[key];data=nextData;
  const pred=decodeArray(data.positions,Float32Array),reference=decodeArray(data.referencePositions,Float32Array),frameIds=decodeArray(data.frames,Uint16Array),cameraIds=decodeArray(data.cameras,Uint8Array);
  const {colors,exposed}=displayColors(decodeArray(data.rgb,Uint8Array));
  poseIndex=poseIndexFor(frameIds,data.frameIds);
  span=robustBounds(reference,center);
  unit=Math.min(1.5,Math.max(.05,span/VIEW.refSpan));gridMajor=niceStep(10*unit);
  sources={pred:{positions:pred,poses:data.poses},reference:{positions:reference,poses:data.referencePoses}};
  const ring=cfg.groundRing||[2,10];   // 估计地面的水平环（米），可按数据集覆盖
  for(const s of Object.values(sources)){s.offset=groundOffset(s.positions,s.poses,poseIndex,ring);s.attribute=new T.BufferAttribute(s.positions,3);s.height=new T.BufferAttribute(heightAboveGround(s.positions,s.poses,poseIndex,s.offset),1)}
  if(cloud){scene.remove(cloud);geometry.dispose()}
  geometry=new T.BufferGeometry();geometry.setAttribute('position',sources[poseSource].attribute);geometry.setAttribute('aHeight',sources[poseSource].height);geometry.setAttribute('color',new T.BufferAttribute(colors,3));geometry.setAttribute('aFrame',new T.Float32BufferAttribute(frameIds,1));geometry.setAttribute('aCamera',new T.Float32BufferAttribute(cameraIds,1));
  cloud=new T.Points(geometry,material);cloud.frustumCulled=false;scene.add(cloud);
  // 尺度相关
  uniforms.uHeightTop.value=cfg.heightTop;uniforms.uClip.value=cfg.clipAbove||1e9;uniforms.uRefDist.value=span;uniforms.uFogNear.value=span*.6;uniforms.uFogFar.value=span*2.4;uniforms.uFront.value=data.frontCamera;
  groundUniforms.uRadius.value=75*unit;groundUniforms.uMajor.value=gridMajor;groundUniforms.uMinor.value=gridMajor/5;ground.scale.set(75*unit,75*unit,1);
  rigBody.scale.setScalar(unit);footprint.scale.setScalar(unit);startMarker.scale.setScalar(unit);dropMaterial.dashSize=.35*unit;dropMaterial.gapSize=.25*unit;
  controls.minDistance=6*unit;controls.maxDistance=span*4;camera.near=Math.max(.02,.1*unit);camera.updateProjectionMatrix();
  buildFrusta();frusta.forEach((f,i)=>f.visible=mode==='multi'||i===data.frontCamera);
  counts={frameIds,cameraIds};buildCounts();
  // 界面文字
  const slider=$('#map-time');slider.min=data.first;slider.max=data.last;slider.step=data.frameIds.length>1?data.frameIds[1]-data.frameIds[0]:1;
  $('#grid-label').textContent=`Ground grid under current rig · ${gridMajor} m`;$('#height-range').textContent=`0–${cfg.heightTop} m`;
  $('#camera-count').textContent=`All ${data.extrinsics.length} cameras`;
  $('#map-caption').textContent=mode==='mono'?`Single-camera map · ${data.cameraLabels[data.frontCamera]}`:`${data.extrinsics.length}-camera map`;
  setSprite();activePathSource=null;lineGeometry.dispose();lineGeometry=new LineGeometry();trajectory.geometry=lineGeometry;
  const initial=cfg.initial!=null?cfg.initial:data.last;updateFrame(initial);previousRig.copy(rigPosition);resetView();
 }
 // 逐帧累计可见点数（排除离地高度裁剪掉的点；位姿来源切换后重算）
 function buildCounts(){const {frameIds,cameraIds}=counts,h=sources[poseSource].height.array,clip=cfg.clipAbove||1e9;
  cumulativeMulti=new Uint32Array(data.last-data.first+1);cumulativeMono=new Uint32Array(cumulativeMulti.length);
  for(let i=0;i<frameIds.length;i++){if(h[i]>=clip)continue;const o=frameIds[i]-data.first;cumulativeMulti[o]++;if(cameraIds[i]===data.frontCamera)cumulativeMono[o]++}
  for(let i=1;i<cumulativeMulti.length;i++){cumulativeMulti[i]+=cumulativeMulti[i-1];cumulativeMono[i]+=cumulativeMono[i-1]}}
 function updateFrame(frame){currentFrame=Math.max(data.first,Math.min(data.last,Math.round(frame)));uniforms.uFrame.value=currentFrame;const i=indexFor(currentFrame),poses=getPoses(),pose=poses[i];rig.matrix.fromArray(pose.flat()).transpose();rig.matrixWorldNeedsUpdate=true;
  previousRig.copy(rigPosition);rigPosition.set(pose[0][3],pose[1][3],pose[2][3]);const groundY=rigPosition.y+sources[poseSource].offset;
  // 跟随模式：相机与目标随 rig 平移，保留用户当前的观察角度
  if(follow){const delta=rigPosition.clone().sub(previousRig);controls.target.add(delta);camera.position.add(delta);controls.update()}
  ground.position.set(rigPosition.x,groundY,rigPosition.z);groundUniforms.uCenter.value.set(rigPosition.x,rigPosition.z);footprint.position.set(rigPosition.x,groundY+.04*unit,rigPosition.z);
  const linePos=dropGeometry.attributes.position;linePos.setXYZ(0,rigPosition.x,rigPosition.y,rigPosition.z);linePos.setXYZ(1,rigPosition.x,groundY,rigPosition.z);linePos.needsUpdate=true;drop.computeLineDistances();
  if(activePathSource!==poseSource){lineGeometry.setPositions(poses.flatMap(p=>[p[0][3],p[1][3],p[2][3]]));trajectory.computeLineDistances();activePathSource=poseSource}lineGeometry.instanceCount=i;startMarker.position.set(poses[0][0][3],poses[0][1][3],poses[0][2][3]);
  $('#map-time').value=currentFrame;$('#map-time-label').textContent=`Rig ${currentFrame-data.first+1} / ${data.last-data.first+1}`;
  const count=(mode==='multi'?cumulativeMulti:cumulativeMono)[currentFrame-data.first];$('#point-count').textContent=count.toLocaleString('en-US')+' points';
  drawInputs();
  render();
 }
 // 同步输入图：每个数据集一张精灵图（行=时刻、列=相机），面板展开时预载一次，之后每帧只做一次 drawImage
 let sprite=null,spriteImg=null;
 function setSprite(){sprite=data.sprite||(window.STREAMRIG_SPRITES&&window.STREAMRIG_SPRITES[key])||null;spriteImg=null;const c=$('#map-inputs');if(sprite){c.width=sprite.tile*sprite.cams;c.height=sprite.tile}c.getContext('2d').clearRect(0,0,c.width,c.height);delete c.dataset.row;if($('#inputs-panel').open)loadSprite()}
 function loadSprite(){if(!sprite||spriteImg)return;const img=new Image();img.decoding='async';img.onload=()=>{if(spriteImg===img)drawInputs()};img.src=versioned('assets/'+sprite.file);spriteImg=img}
 function drawInputs(){if(!sprite||!spriteImg||!spriteImg.complete||!spriteImg.naturalWidth||!$('#inputs-panel').open)return;const f=sprite.frames;let lo=0,hi=f.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(f[mid]<=currentFrame)lo=mid;else hi=mid-1}
  const w=sprite.tile*sprite.cams;const c=$('#map-inputs');c.getContext('2d').drawImage(spriteImg,0,lo*sprite.tile,w,sprite.tile,0,0,w,sprite.tile);c.dataset.row=lo}
 $('#inputs-panel').addEventListener('toggle',()=>{if($('#inputs-panel').open){loadSprite();drawInputs()}});
 function updateAxes(){const q=camera.quaternion.clone().invert(),origin={x:43,y:45};const axes=[{v:new T.Vector3(1,0,0),color:'#f08c8c',label:'X'},{v:new T.Vector3(0,1,0),color:'#7fd6a0',label:'UP'},{v:new T.Vector3(0,0,1),color:'#8fb0ea',label:'Z'}];let svg='';for(const axis of axes){const v=axis.v.applyQuaternion(q);const x=origin.x+v.x*26,y=origin.y-v.y*26;svg+=`<line x1="${origin.x}" y1="${origin.y}" x2="${x}" y2="${y}" stroke="${axis.color}" stroke-width="2"/><text x="${x+3}" y="${y+4}" fill="${axis.color}" font-family="Arial" font-size="9">${axis.label}</text>`}$('#axis-svg').innerHTML=svg}
 function render(){if(!data)return;renderer.render(scene,camera);const p=rigPosition.clone().project(camera);const label=$('#rig-label');const w=canvas.clientWidth,h=canvas.clientHeight;label.style.left=(p.x*.5+.5)*w+12+'px';label.style.top=(-p.y*.5+.5)*h-22+'px';label.hidden=p.z>1||Math.abs(p.x)>.87||Math.abs(p.y)>.88;updateAxes()}
 // 默认视角：斜俯视整张地图，窄屏按宽高比拉远
 function resetView(){setFollow(false);const view=new T.Vector3().setFromSphericalCoords(1,VIEW.elevation,VIEW.azimuth),target=new T.Vector3(center.x+view.x*span*.1,center.y-3*unit,center.z+view.z*span*.1);controls.target.copy(target);camera.position.copy(target).add(view.multiplyScalar(span*VIEW.distance).multiplyScalar(Math.max(1,1.75/camera.aspect)));controls.update();render()}
 function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();lineMaterial.resolution.set(w,h);render()}
 controls.addEventListener('change',render);new ResizeObserver(resize).observe(stage);
 function loop(now){raf=0;if(!playing||!visible||document.hidden){lastTick=0;return}if(lastTick){playbackFrame+=(now-lastTick)*.025;updateFrame(playbackFrame);if(currentFrame>=data.last){setPlaying(false);return}}lastTick=now;raf=requestAnimationFrame(loop)}
 function setPlaying(on){playing=on;lastTick=0;playbackFrame=currentFrame;$('#map-play').textContent=on?'Ⅱ Pause':'▶ Play';$('#map-play').setAttribute('aria-label',on?'Pause mapping':'Play mapping');if(on&&!raf)raf=requestAnimationFrame(loop);if(!on&&raf){cancelAnimationFrame(raf);raf=0}}
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible&&playing&&!raf)raf=requestAnimationFrame(loop)}).observe(stage);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&visible&&playing&&!raf)raf=requestAnimationFrame(loop)});
 $('#map-play').addEventListener('click',()=>{if(!data)return;if(!playing&&currentFrame>=data.last)updateFrame(data.first);setPlaying(!playing)});
 $('#map-time').addEventListener('input',e=>{if(!data)return;setPlaying(false);updateFrame(+e.target.value)});
 $$('[data-cameras]').forEach(b=>b.addEventListener('click',()=>{if(!data)return;mode=b.dataset.cameras;uniforms.uMono.value=mode==='mono'?1:0;setPressed('[data-cameras]',mode,'cameras');frusta.forEach((f,i)=>f.visible=mode==='multi'||i===data.frontCamera);$('#map-caption').textContent=mode==='mono'?`Single-camera map · ${data.cameraLabels[data.frontCamera]}`:`${data.extrinsics.length}-camera map`;updateFrame(currentFrame)}));
 $$('[data-pose]').forEach(b=>b.addEventListener('click',()=>{if(!data)return;poseSource=b.dataset.pose;geometry.setAttribute('position',sources[poseSource].attribute);geometry.setAttribute('aHeight',sources[poseSource].height);setPressed('[data-pose]',poseSource,'pose');buildCounts();$('.map-legend>span:first-child').lastChild.textContent=' '+(poseSource==='pred'?'StreamRig':'Reference')+' trajectory';updateFrame(currentFrame)}));
 $$('[data-color]').forEach(b=>b.addEventListener('click',()=>{const color=b.dataset.color;uniforms.uShade.value={rgb:0,current:1,height:2}[color];setPressed('[data-color]',color,'color');$('#height-legend').hidden=color!=='height';render()}));
 $('#point-size').addEventListener('input',e=>{uniforms.uSize.value=+e.target.value;render()});
 $('#show-grid').addEventListener('change',e=>{ground.visible=e.target.checked;footprint.visible=e.target.checked;render()});$('#show-trajectory').addEventListener('change',e=>{trajectory.visible=e.target.checked;startMarker.visible=e.target.checked;render()});
 $('#map-reset').addEventListener('click',resetView);
 // 顶视：正上方俯视并完整框住整张地图
 $('#map-top').addEventListener('click',()=>{setFollow(false);const target=new T.Vector3(center.x,rigPosition.y,center.z),fit=span*.5/Math.tan(T.MathUtils.degToRad(camera.fov/2))/Math.min(1,camera.aspect)*1.08;controls.target.copy(target);camera.position.copy(target).add(new T.Vector3(0,fit,.01*unit));controls.update();render()});
 // 跟随 rig：拉近到当前 rig 后方斜上方，播放时相机随 rig 平移；再次点击取消
 $('#map-focus').addEventListener('click',()=>{if(follow){setFollow(false);return}const yaw=new T.Vector3(0,0,1).applyMatrix4(new T.Matrix4().extractRotation(rig.matrix));yaw.y=0;if(yaw.lengthSq()<1e-6)yaw.set(0,0,1);yaw.normalize();controls.target.copy(rigPosition);camera.position.copy(rigPosition).addScaledVector(yaw,-42*unit).add(new T.Vector3(0,26*unit,0));controls.update();setFollow(true);render()});
 $('#map-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(stage.requestFullscreen)await stage.requestFullscreen();else stage.classList.toggle('expanded')}catch{stage.classList.toggle('expanded')}});
 canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home'){resetView();return}const offset=camera.position.clone().sub(controls.target),s=new T.Spherical().setFromVector3(offset);if(e.key==='ArrowLeft')s.theta-=.12;if(e.key==='ArrowRight')s.theta+=.12;if(e.key==='ArrowUp')s.phi=Math.max(.05,s.phi-.1);if(e.key==='ArrowDown')s.phi=Math.min(Math.PI/2-.06,s.phi+.1);if(e.key==='+'||e.key==='=')s.radius=Math.max(controls.minDistance,s.radius/1.15);if(e.key==='-')s.radius=Math.min(span*4,s.radius*1.15);camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(s));controls.update();render()});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();setPlaying(false);$('#map-fallback').hidden=false});
 // 数据集切换：懒加载数据文件，加载期间显示状态提示
 // 数据集切换（含首次加载 NCLT）：懒加载数据文件，加载期间显示状态提示
 function switchDataset(next){if(next===key&&data&&!switching)return Promise.resolve();setPlaying(false);setPressed('[data-dataset]',next,'dataset');$('#map-loading').textContent='Loading point cloud…';$('#map-loading').hidden=false;
  const job=switching=loadDataset(next).then(d=>{if(switching!==job)return;setDataset(next,d);$('#map-loading').hidden=true;switching=null;exposeView()}).catch(err=>{console.warn(err);$('#map-loading').textContent='This point cloud could not be loaded.';switching=null});return job}
 $$('[data-dataset]').forEach(b=>b.addEventListener('click',()=>switchDataset(b.dataset.dataset)));
 resize();key=null;switchDataset('nclt');
 // 只读状态，供浏览器检查脚本验证数据相关交互（首个数据集加载完成后才暴露）
 function exposeView(){if(window.STREAMRIG_VIEW)return;window.STREAMRIG_VIEW={snapshot:()=>({dataset:key,frame:currentFrame,cameras:mode,poseSource,visiblePoints:+$('#point-count').textContent.replace(/\D/g,''),polarAngle:controls.getPolarAngle(),up:camera.up.toArray(),playing,following:follow,loading:!!switching,groundOffset:{pred:sources.pred.offset,reference:sources.reference.offset},target:controls.target.toArray(),webgl:true}),capture:()=>{render();return canvas.toDataURL('image/png')}}}
}
try{if(!window.StreamRigGL)throw Error('WebGL viewer unavailable');startMap()}catch(error){console.warn('Map viewer unavailable:',error);$('#map-loading').hidden=true;$('#map-fallback').hidden=false;$$('.map-controls button,.timeline button,.timeline input,.stage-toolbar button,.map-controls input,.map-legend input,.dataset-tabs button').forEach(el=>el.disabled=true)}
})();

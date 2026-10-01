'use strict';
// StreamRig 主页顶部像素风背景：一条连续道路穿过四个数据集地貌（NCLT 校园 / KITTI-360 街区 / TartanGround 废弃厂区 / ZJH 室内），
// rig 随地貌切换平台（Segway / 汽车 / 轮式机器人 / 人形），多相机视锥边走边留下建图点；身后为历史位姿，
// 每 N 步插锚旗（re-anchoring），当前 rig 以虚线连向锚点以来的历史帧、以弧线连向锚点（因果注意力读取锚点）。
// 交互：点击地图立即重锚；悬停 rig 高亮视锥；暂停按钮；prefers-reduced-motion 时只画静态帧。
(function(){
const canvas=document.getElementById('hero-canvas');if(!canvas)return;
const ctx=canvas.getContext('2d');
// 文字覆盖层：按 CSS 尺寸 × 设备像素比绘制，文字不随像素画布放大而变糊
const lab=document.getElementById('hero-labels'),lctx=lab?lab.getContext('2d'):null;
const LABEL_FONT='20px "Jersey 20", monospace';   // 像素网格字体，按其网格的整数倍取字号保持锐利
let sx=3,sy=3,dpr=1;   // resize() 中按实际尺寸更新
const PX=3;                 // 每个逻辑像素占 3 个 CSS 像素
const SPEED=16;             // 世界滚动速度（逻辑像素/秒）
const STEP=7,ANCHOR_EVERY=10,BIOME_LEN=293,BAND=64;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 调色板与精灵 ----------
const PAL={d:'#2e5a27',k:'#1f2a44',g:'#4f8f3a',G:'#86c05a',l:'#b9df7c',t:'#6b4a2b',r:'#c8453a',R:'#e76f51',w:'#fffaf0',y:'#f4c542',o:'#e08a3c',s:'#aab2bb',S:'#6f7782',b:'#5b9bd5',B:'#2f6fa3',c:'#d8bc86',C:'#a8875a',p:'#d9a26b',P:'#a8723f',m:'#7c5aa6',M:'#5b3f80',n:'#454b55',e:'#93c9e8'};
const SPR={
 tree:["..ddddd..",".dgGGGgd.","dgGlGGGgd","dGGlGGGGd","dGGGGGGgd","dgGGGGGgd",".dgggggd.","..dddtd..","....t...."],
 pine:["...d...","..dGd..","..dGd..",".dGlGd.",".dGGGd.","dGGlGGd","dgGGGgd","ddddddd","...t..."],
 bush:[".ddd.","dGlGd","dgGgd",".ddd."],
 hall:["kkkkkkkkkkkkkkkk","kSSSSSSSSSSSSSSk","kSssssssssssssSk","kkkkkkkkkkkkkkkk","kwwwwwwwwwwwwwwk","kwBwwBwwBwwBwwwk","kwBwwBwwBwwBwwwk","kwwwwwwwwwwwwwwk","kwBwwBwkkkwBwwwk","kkkkkkkkkkkkkkkk"],
 house:["....kkkk....","..kkrrrrkk..",".krrRRRRrrk.","krrrrrrrrrrk","kkkkkkkkkkkk",".kwwwwwwwwk.",".kwbwwwwbwk.",".kwbwkkwbwk.",".kwwwkkwwwk.",".kkkkkkkkkk."],
 car:[".kkkk.","kbbbbk","kBeeBk","kbbbbk","kbbbbk","kBeeBk","kbbbbk",".kkkk."],
 carR:[".kkkk.","krrrrk","kReeRk","krrrrk","krrrrk","kReeRk","krrrrk",".kkkk."],
 crate:["kkkkkk","kPpPpk","kpPpPk","kPpPpk","kpPpPk","kkkkkk"],
 barrel:[".kkk.","kooRk","kkkkk","kooRk","kooRk",".kkk."],
 ruin:["kkk..kkkk.kk","ksSkksSsSkSk","kSsSsSsSsSsk","kkkkkkkkkkkk"],
 rock:[".kkk..","kssSk.","kssssk",".kkkk."],
 sofa:["kkkkkkkkkkkk","kMMMMMMMMMMk","kMmmmmmmmmMk","kMmmmmmmmmMk","kMMkkkkkkMMk","kkk......kkk"],
 table:["kkkkkkkk","kppppppk","kpPPPPpk","kppppppk","kkkkkkkk"],
 plant:[".dGd.","dGlGd",".dGd.","kPPPk",".kPk."],
 pond:["...kkkkk...",".kkeeeeekk.","keebbbbbeek","kebbbBbbbek","keebbbbbeek",".kkeeeeekk.","...kkkkk..."],
 flag:["kRRR..","kRRRR.","kRRR..","k.....","k.....","k.....","k.....","kk...."],
 // rig 平台（俯视）：Segway（5 目）/ 汽车（4 目）/ 轮式机器人（4 目）/ 人形（4 目）
 segway:["..kkkkk..",".kyyyyyk.",".kykkkyk.",".kykwkyk.",".kykkkyk.",".kyyyyyk.","..kkkkk..","..kS.Sk..","..kk.kk.."],
 rigcar:[".kkkkkkkkk.","kooooooooyk","koeeoooeeok","koeeokoeeok","koeeoooeeok","kooooooooyk",".kkkkkkkkk."],
 robot:["kk.....kk","kkkkkkkkk",".kSSSSSk.",".kSyyySk.",".kSykySk.",".kSyyySk.",".kSSSSSk.","kkkkkkkkk","kk.....kk"],
 humanoid:["...kkk...","..kwwwk..","..kwkwk..","..kwwwk..",".kkkkkkk.","kbbbbbbbk","kbkbbbkbk",".kbbbbbk.","..kk.kk.."]
};
const cache={};
function sprite(name,scale=1){const key=name+scale;if(cache[key])return cache[key];const rows=SPR[name],c=document.createElement('canvas');c.width=rows[0].length*scale;c.height=rows.length*scale;const g=c.getContext('2d');
 rows.forEach((row,y)=>[...row].forEach((ch,x)=>{if(ch==='.')return;g.fillStyle=PAL[ch];g.fillRect(x*scale,y*scale,scale,scale)}));return cache[key]=c}

// ---------- 数据集地貌 ----------
const BIOMES=[
 {key:'nclt',label:'NCLT',rig:'segway',cams:[0,72,144,216,288],fov:30,deco:['tree','tree','pine','bush','hall','bush'],desc:'5 cameras'},
 {key:'k360',label:'KITTI-360',rig:'rigcar',cams:[0,0,90,-90],fov:[18,18,40,40],deco:['house','car','carR','tree','house','bush'],desc:'4 cameras'},
 {key:'tg',label:'TartanGround',rig:'robot',cams:[0,90,180,270],fov:38,deco:['ruin','crate','barrel','rock','ruin','pine'],desc:'4 cameras'},
 {key:'zjh',label:'ZJH Humanoid',rig:'humanoid',cams:[0,0,50,-50],fov:[22,22,30,30],deco:['sofa','table','plant','crate','sofa','plant'],desc:'4 cameras'}
];
const biomeAt=wx=>BIOMES[((Math.floor(wx/BIOME_LEN)%4)+4)%4];
function hash(a,b=0){let h=(a*374761393+b*668265263)^0x5bd1e995;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296}

// ---------- 画布尺寸与世界几何 ----------
let W=0,H=0,img=null,camX=0,last=0,running=!reduced,visible=true,raf=0,hover=false,mouse=null;
function resize(){const r=canvas.getBoundingClientRect();W=Math.max(1,Math.ceil(r.width/PX));H=Math.max(1,Math.ceil(r.height/PX));canvas.width=W;canvas.height=H;img=ctx.createImageData(W,H);
 sx=r.width/W;sy=r.height/H;dpr=Math.min(devicePixelRatio||1,2);if(lab){lab.width=Math.round(r.width*dpr);lab.height=Math.round(r.height*dpr)}draw()}
const roadY=wx=>Math.round(H-BAND/2-2+5*Math.sin(wx/47)+3*Math.sin(wx/19+1.3));
const bandTop=wx=>H-BAND+Math.round(1.5*Math.sin(wx/9)+2*hash(Math.floor(wx/3),7));
const rigScreenX=()=>Math.round(W*.2);

// ---------- 背景逐像素着色 ----------
const RGB=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
function groundColor(b,wx,y,n){
 if(b.key==='nclt')return n<.07?[172,214,112]:n>.96?[106,160,70]:n>.93&&n<.935?[244,197,66]:[138,194,92];
 if(b.key==='k360'){const tile=(wx%10===0||y%10===0);return tile?[176,180,186]:n<.05?[206,208,212]:[194,197,202]}
 if(b.key==='tg')return n<.08?[198,166,108]:n>.97?[160,128,84]:[218,190,134];
 const row=Math.floor(y/5),seam=y%5===0||((wx+row*13)%29===0);return seam?[160,110,62]:row%2?[204,154,98]:[194,142,88];
}
function roadColor(b,wx,dy){const edge=Math.abs(dy)>=4;
 if(b.key==='nclt')return edge?[176,146,100]:(dy===0&&(wx%10)<5)?[150,98,60]:[230,210,166];
 if(b.key==='k360')return edge?[70,74,82]:(dy===0&&(wx%12)<6)?[250,250,246]:[98,104,114];
 if(b.key==='tg')return edge?[150,118,78]:(Math.abs(dy)===2)?[168,136,92]:[192,160,110];
 return edge?[214,168,62]:(dy===0&&(wx%8)<4)?[232,196,120]:[168,68,64];
}
function paintBackground(){const d=img.data,par=camX*.35;
 for(let x=0;x<W;x++){const wx=Math.floor(x+camX),b=biomeAt(wx),top=bandTop(wx),ry=roadY(wx),px=x+par;
  const contours=[];for(let c=0;c<6;c++)contours.push(Math.round(H*.07+c*(H-BAND)*.17+5*Math.sin(px/37+c)+3*Math.sin(px/15+c*2)));
  for(let y=0;y<H;y++){const i=(y*W+x)*4,n=hash(wx,y);let col;
   if(y<top){col=n<.04?[236,223,192]:[245,234,208];if(contours.includes(y)&&((Math.floor(px)+y)%3))col=[224,206,168]}
   else if(Math.abs(y-ry)<=4)col=roadColor(b,wx,y-ry);
   else if(y===top)col=[120,98,70];
   else col=groundColor(b,wx,y,n);
   d[i]=col[0];d[i+1]=col[1];d[i+2]=col[2];d[i+3]=255}}
 ctx.putImageData(img,0,0);
}

// ---------- 装饰物（按世界网格确定性摆放，逐 y 排序绘制） ----------
function decorations(){const list=[],cell=18,start=Math.floor(camX/cell)-2,end=Math.floor((camX+W)/cell)+2;
 for(let c=start;c<=end;c++){const wx=c*cell,b=biomeAt(wx);if(wx%BIOME_LEN<34)continue;
  for(let k=0;k<2;k++){const h=hash(c,k+11);if(h>.62)continue;const name=b.deco[Math.floor(hash(c,k+23)*b.deco.length)],s=sprite(name),ry=roadY(wx),top=bandTop(wx)+2;
   const above=k===0,y=above?ry-6-s.height-Math.floor(hash(c,k+5)*Math.max(1,ry-6-s.height-top)):ry+6+Math.floor(hash(c,k+9)*Math.max(1,H-ry-8-s.height));
   if(y<top||y+s.height>H)continue;list.push({s,x:Math.round(wx+hash(c,k+3)*6-camX),y})}}
 // 羊皮纸区域的远景点缀（视差 0.5）
 const far=34,fs=Math.floor(camX*.5/far)-1,fe=Math.floor((camX*.5+W)/far)+1;
 for(let c=fs;c<=fe;c++){if(hash(c,91)>.8)continue;const name=['pine','tree','rock','bush','pond','pine'][Math.floor(hash(c,93)*6)],s=sprite(name),y=Math.round(6+hash(c,97)*(H-BAND-s.height-12)),x=Math.round(c*far+hash(c,95)*30-camX*.5);list.push({s,x,y});
  // 小树丛：主体旁再放 1–2 个灌木/松树，形成像素「小岛」
  for(let j=0;j<2;j++){if(hash(c,101+j)>.5)continue;const t=sprite(hash(c,103+j)>.5?'bush':'pine');list.push({s:t,x:x+(j?-t.width-1:s.width+1),y:y+s.height-t.height})}}
 return list.sort((a,b)=>a.y+a.s.height-(b.y+b.s.height));
}
function signposts(){const out=[];const k0=Math.floor(camX/BIOME_LEN),k1=Math.floor((camX+W)/BIOME_LEN);
 for(let k=k0;k<=k1+1;k++){const wx=k*BIOME_LEN+14,x=Math.round(wx-camX);if(x<-80||x>W+10)continue;out.push({x,y:roadY(wx)-7,label:biomeAt(wx+20).label})}return out}

// ---------- rig 状态：轨迹、锚点、建图点 ----------
let trail=[],anchors=[],points=[],nextStep=0,sinceAnchor=0,burst=0,lastBiome=null;
const rigWX=()=>camX+rigScreenX();
function heading(wx){return Math.atan2(roadY(wx+2)-roadY(wx-2),4)}
function dropAnchor(){const wx=rigWX();anchors.push({x:wx,y:roadY(wx)});sinceAnchor=0;burst=1;if(anchors.length>40)anchors.shift()}
function stepRig(){const wx=rigWX();if(wx<nextStep)return;nextStep=wx+STEP;trail.push({x:wx,y:roadY(wx)});if(trail.length>400)trail.shift();
 // 每 ANCHOR_EVERY 步重锚；进入新地貌（新数据集）时立即重锚
 const biomeKey=biomeAt(wx).key,entered=biomeKey!==lastBiome;lastBiome=biomeKey;
 if(entered||++sinceAnchor>=ANCHOR_EVERY||!anchors.length)dropAnchor();
 // 视锥内撒建图点（世界坐标，持久保留，颜色按与 rig 的距离）
 const b=biomeAt(wx),hd=heading(wx),y0=roadY(wx);
 // 建图点 = 相机射线打到物体（装饰物包围框）的位置，累积后勾勒出物体轮廓
 const boxes=decorations().map(d=>({x0:d.x+camX,y0:d.y,x1:d.x+camX+d.s.width,y1:d.y+d.s.height}));
 b.cams.forEach((a,i)=>{const fov=Array.isArray(b.fov)?b.fov[i]:b.fov;for(let k=0;k<6;k++){const ang=hd+(a+(Math.random()*2-1)*fov)*Math.PI/180,cx=Math.cos(ang),cy=Math.sin(ang);
  for(let dist=4;dist<=34;dist+=.7){const px=wx+cx*dist,py=y0+cy*dist;if(py<0||py>=H)break;if(boxes.some(q=>px>=q.x0&&px<q.x1&&py>=q.y0&&py<q.y1)){points.push({x:px,y:py,t:dist/34});break}}}});
 if(points.length>2600)points.splice(0,points.length-2600);
}
const VIRIDIS=['#31688e','#21918c','#35b779','#90d743','#fde725'];

// ---------- 绘制 ----------
function line(x0,y0,x1,y1,color,dash){ctx.fillStyle=color;const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));for(let i=0;i<=n;i+=dash){const t=n?i/n:0;ctx.fillRect(Math.round(x0+(x1-x0)*t),Math.round(y0+(y1-y0)*t),1,1)}}
function drawRig(){const wx=rigWX(),x=rigScreenX(),y=roadY(wx),b=biomeAt(wx),hd=heading(wx);
 // 视锥
 b.cams.forEach((a,i)=>{const fov=(Array.isArray(b.fov)?b.fov[i]:b.fov)*Math.PI/180,ang=hd+a*Math.PI/180,len=hover?30:24,off=(i===1&&b.cams[0]===b.cams[1])?3:0;
  const ox=x-Math.sin(ang)*off,oy=y+Math.cos(ang)*off;ctx.globalAlpha=hover?.5:.34;ctx.fillStyle=i===0?'#f4c542':'#ffe28a';ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox+Math.cos(ang-fov)*len,oy+Math.sin(ang-fov)*len);ctx.lineTo(ox+Math.cos(ang+fov)*len,oy+Math.sin(ang+fov)*len);ctx.closePath();ctx.fill();ctx.globalAlpha=1});
 const s=sprite(b.rig,2);ctx.drawImage(s,x-s.width/2,y-s.height/2);
}
function draw(){if(!W)return;paintBackground();
 // 建图点
 for(const p of points){const x=Math.round(p.x-camX);if(x<0||x>=W)continue;ctx.fillStyle=VIRIDIS[Math.min(4,Math.floor(p.t*5))];ctx.fillRect(x,Math.round(p.y),1,1)}
 const decos=decorations();for(const d of decos){ctx.fillStyle='rgba(31,42,68,.18)';ctx.fillRect(d.x+1,d.y+d.s.height-1,d.s.width,2)}
 for(const d of decos)ctx.drawImage(d.s,d.x,d.y);
 for(const s of signposts()){ctx.fillStyle='#6b4a2b';ctx.fillRect(s.x,s.y-4,2,12)}   // 路牌木杆（牌面与文字在覆盖层）
 // 历史位姿与因果连线
 const anchor=anchors[anchors.length-1],rx=rigScreenX(),ry=roadY(rigWX());
 trail.forEach(p=>{const x=Math.round(p.x-camX);if(x<-3||x>W)return;const live=anchor&&p.x>=anchor.x;if(live){line(rx,ry,x,p.y,'rgba(231,111,81,.7)',2);ctx.fillStyle='#fffaf0';ctx.fillRect(x-2,p.y-2,5,5);ctx.fillStyle='#1f2a44';ctx.fillRect(x-1,p.y-1,3,3)}else{ctx.fillStyle='rgba(31,42,68,.45)';ctx.fillRect(x-1,p.y-1,2,2)}});
 if(anchor){const ax=Math.round(anchor.x-camX),mx=(ax+rx)/2,my=Math.min(ry,anchor.y)-14-8*burst;ctx.fillStyle='#d9483b';for(let t=0;t<=1;t+=.012){const x=(1-t)*(1-t)*ax+2*(1-t)*t*mx+t*t*rx,y=(1-t)*(1-t)*anchor.y+2*(1-t)*t*my+t*t*ry;ctx.fillRect(Math.round(x),Math.round(y)-1,2,2)}}
 const f=sprite('flag');anchors.forEach(a=>{const x=Math.round(a.x-camX);if(x>-8&&x<W)ctx.drawImage(f,x,a.y-f.height)});
 drawRig();
 // 指南针（右上角，致敬 G2G 海报）
 const cx=W-14,cy=17;ctx.fillStyle='#1f2a44';for(let k=-5;k<=5;k++){ctx.fillRect(cx+k,cy,1,1);ctx.fillRect(cx,cy+k,1,1)}ctx.fillRect(cx-1,cy-1,3,3);
 drawLabels();
}
// 覆盖层文字：路牌、悬停提示、指南针 N（CSS 像素坐标）
function board(text,x,y,dark){lctx.font=LABEL_FONT;const w=Math.ceil(lctx.measureText(text).width)+16,h=26,bx=Math.round(Math.min(lab.width/dpr-w-4,Math.max(4,x))),by=Math.round(y-h);
 lctx.fillStyle='#1f2a44';lctx.fillRect(bx-2,by-2,w+4,h+4);lctx.fillStyle=dark?'#1f2a44':'#fffaf0';lctx.fillRect(bx,by,w,h);lctx.fillStyle=dark?'#fffaf0':'#1f2a44';lctx.fillText(text,bx+8,by+20)}
function drawLabels(){if(!lctx)return;lctx.setTransform(dpr,0,0,dpr,0,0);lctx.clearRect(0,0,lab.width,lab.height);lctx.textBaseline='alphabetic';
 for(const s of signposts())board(s.label,(s.x-3)*sx,(s.y-4)*sy,false);
 if(hover){const b=biomeAt(rigWX()),rs=sprite(b.rig,2);board(`${b.label} · ${b.desc}`,rigScreenX()*sx-70,(roadY(rigWX())-rs.height/2-3)*sy,true)}
 lctx.font=LABEL_FONT;lctx.fillStyle='#1f2a44';lctx.fillText('N',(W-14)*sx-4,(17-8)*sy)}
function frame(now){raf=0;if(!running||!visible||document.hidden){last=0;return}const dt=last?Math.min(.05,(now-last)/1000):0;last=now;camX+=SPEED*dt;burst=Math.max(0,burst-dt*2);stepRig();draw();raf=requestAnimationFrame(frame)}
function play(){if(!raf&&running)raf=requestAnimationFrame(frame)}

// ---------- 交互 ----------
canvas.addEventListener('click',()=>{dropAnchor();draw()});
canvas.addEventListener('mousemove',e=>{const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/PX,y=(e.clientY-r.top)/PX;const was=hover;hover=Math.hypot(x-rigScreenX(),y-roadY(rigWX()))<14;canvas.style.cursor=hover?'help':'pointer';if(was!==hover&&!running)draw()});
canvas.addEventListener('mouseleave',()=>{hover=false;if(!running)draw()});
const pause=document.getElementById('hero-pause');
if(pause){const sync=()=>{pause.textContent=running?'Pause':'Play';pause.setAttribute('aria-pressed',String(!running))};sync();pause.addEventListener('click',()=>{running=!running;sync();last=0;play()})}
new IntersectionObserver(es=>{visible=es[0].isIntersecting;play()}).observe(canvas);
document.addEventListener('visibilitychange',play);
new ResizeObserver(resize).observe(canvas);

// 初始化：预先推进一段，让画面一开始就有轨迹、锚点和建图点
function warmup(){for(let i=0;i<180;i++){camX+=SPEED/10;stepRig()}}
(document.fonts&&document.fonts.load?document.fonts.load('20px "Jersey 20"'):Promise.resolve()).catch(()=>{}).then(()=>{resize();warmup();draw();play();window.STREAMRIG_HERO_T0=performance.now()});
window.STREAMRIG_HERO={snapshot:()=>({running,camX,anchors:anchors.length,trail:trail.length,points:points.length,biome:biomeAt(rigWX()).key,W,H,biomeLen:BIOME_LEN,anchorX:anchors.map(a=>a.x),trailX:trail.map(t=>t.x)})};
})();

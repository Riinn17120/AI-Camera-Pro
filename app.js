/* =====================================================================
   app.js — Bộ điều khiển chính của AI Camera Pro
   Nạp sau style.css, index.html và ai-engine.js.
   ===================================================================== */
'use strict';

/* ---------- DOM & tiện ích dùng chung ---------- */
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const note = (s, good=false) => { $('camNote').textContent=s; $('camNote').style.color=good?'var(--gn)':'var(--mu)'; };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const blobOf = (canvas, quality=.92) => new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Không tạo được ảnh.')),'image/jpeg',quality));
const bmp = async blob => {
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  const url=URL.createObjectURL(blob);
  try { const im=new Image(); im.src=url; await im.decode(); return im; }
  finally { URL.revokeObjectURL(url); }
};
const thumbOf = async blob => {
  const im=await bmp(blob), c=document.createElement('canvas');
  const k=Math.min(1,320/Math.max(im.width,im.height)); c.width=Math.max(1,Math.round(im.width*k)); c.height=Math.max(1,Math.round(im.height*k));
  c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  if(im.close) im.close();
  return await blobOf(c,.78);
};

/* ---------- Trạng thái camera ---------- */
let stream=null, vid=$('vid'), ov=$('ov'), demo=$('demo'), digital=1, mode='photo', aiOn=false;
let facing='environment', camCaps=null, hardwareEV=false, srcBmp=null;
let camDevices=[], activeDeviceId=null, currentTrack=null, flashOn=false, gridOn=false;
let P={ev:0,iso:100,shutter:0,wb:5500,focus:0,ct:0};
let hardwareZoom=false, maxZoom=1;
let captureBusy=false, cameraReady=false, cameraTimer=null;
let currentLook='natural', cropR=null;
const LOOKS={natural:null,cinema:{contrast:1.08,saturate:.9},warm:{sepia:.12,saturate:1.12},moody:{contrast:1.16,saturate:.82},vintage:{sepia:.18,contrast:.92,saturate:.82},mono:{grayscale:1}};
function src(){return stream&&vid.readyState>=2&&vid.videoWidth?vid:demo}
function crop(source){
  const W=source.videoWidth||source.width,H=source.videoHeight||source.height;
  if(!cropR)return [0,0,W,H];
  return [cropR[0]*W,cropR[1]*H,cropR[2]*W,cropR[3]*H];
}
function applyView(){
  const s=src();
  if(s===vid){vid.style.display='block';demo.style.display='none';}
  const z=clamp(digital,1,5);
  [vid,demo].forEach(el=>{el.style.transform=`scale(${z})`;});
}
function syncPro(){
  $('pvEV').textContent=Number(P.ev).toFixed(1);$('pvISO').textContent=P.iso;
  $('pvShutter').textContent=P.shutter?`1/${Math.round(1/P.shutter)}`:'Auto';
  $('pvWB').textContent=`${P.wb}K`;$('pvFocus').textContent=P.focus?'MF':'AF';$('pvCT').textContent=P.ct;
  $('pEV').value=P.ev;$('oEV').textContent=Number(P.ev).toFixed(1);
  $('pISO').value=P.iso;$('oISO').textContent=P.iso;$('pWB').value=P.wb;$('oWB').textContent=P.wb;
  $('pCT').value=P.ct;$('oCT').textContent=P.ct;
}
async function applyRealCameraControl(name,value){
  if(!currentTrack) return false;
  try{
    const caps=currentTrack.getCapabilities?.()||{};
    if(name==='exposureCompensation'&&caps.exposureCompensation){
      await currentTrack.applyConstraints({advanced:[{exposureCompensation:value}]}); hardwareEV=true; return true;
    }
    if(name==='zoom'&&caps.zoom){await currentTrack.applyConstraints({advanced:[{zoom:value}]});return true;}
  }catch(e){console.warn('Camera control:',e)}
  return false;
}
function resizeOverlay(){
  const r=$('vf').getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
  ov.width=Math.max(1,Math.round(r.width*dpr));ov.height=Math.max(1,Math.round(r.height*dpr));
  ov.style.width=r.width+'px';ov.style.height=r.height+'px';
  const ctx=ov.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  drawOverlay();
}
function drawOverlay(){
  const ctx=ov.getContext('2d'),r=$('vf').getBoundingClientRect(),w=r.width,h=r.height,dpr=Math.min(2,window.devicePixelRatio||1);
  ctx.clearRect(0,0,ov.width,ov.height);ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
  if(gridOn){ctx.strokeStyle='#ffffff70';ctx.lineWidth=1;for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(w*i/3,0);ctx.lineTo(w*i/3,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,h*i/3);ctx.lineTo(w,h*i/3);ctx.stroke();}}
  const l=LOOKS[currentLook]; if(l){ctx.fillStyle=l.grayscale?'#8882':l.sepia?'#a66b2730':'#17243b20';ctx.fillRect(0,0,w,h);}
  ctx.restore();
}
function setMode(m){
  if(!['photo','portrait','night','pro'].includes(m))return;
  mode=m;document.querySelectorAll('#modes b').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  $('pro').classList.toggle('on',m==='pro');
  if(m==='night')note('Chế độ Đêm: giữ máy ổn định khi chụp.');
  else if(m==='portrait')note('Chân dung: giữ khuôn mặt trong vùng lấy nét.');
  else note(m==='pro'?'Điều chỉnh thủ công các thông số khả dụng.':'');
}
async function enumerateCameras(){
  try{camDevices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');}catch(_){camDevices=[]}
  const lens=$('lens');lens.innerHTML='';
  camDevices.forEach((d,i)=>{
    const b=document.createElement('button');b.textContent=i===0?'1×':i===1?'2':'3';b.title=d.label||`Camera ${i+1}`;
    b.classList.toggle('on',d.deviceId===activeDeviceId);b.onclick=()=>startCamera(d.deviceId);lens.append(b);
  });
  if(camDevices.length<2){lens.innerHTML='';}
}
async function startCamera(deviceId=null){
  if(!navigator.mediaDevices?.getUserMedia){note('Trình duyệt không hỗ trợ camera.',false);return;}
  try{
    if(stream)stream.getTracks().forEach(t=>t.stop());
    const constraints={audio:false,video:deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:facing},width:{ideal:3840},height:{ideal:2160}}};
    stream=await navigator.mediaDevices.getUserMedia(constraints);vid.srcObject=stream;await vid.play();
    currentTrack=stream.getVideoTracks()[0];activeDeviceId=currentTrack.getSettings().deviceId||deviceId;
    camCaps=currentTrack.getCapabilities?.()||{};hardwareEV=!!camCaps.exposureCompensation;
    hardwareZoom=!!camCaps.zoom;maxZoom=camCaps.zoom?.max||1;
    cameraReady=true;vid.style.display='block';demo.style.display='none';digital=1;
    applyView();resizeOverlay();await enumerateCameras();
    $('camNote').textContent=`${vid.videoWidth} × ${vid.videoHeight} · Camera sẵn sàng`;
    $('bRes').textContent=vid.videoWidth>=3840?'📐 4K':`${vid.videoWidth>=1920?'📐 FHD':'📐 HD'}`;
    $('proSupport').textContent=hardwareEV?'Có điều khiển phơi sáng':'Một số thông số chỉ mô phỏng trong bản Web';
    if(camCaps.exposureCompensation){P.ev=clamp(P.ev,camCaps.exposureCompensation.min,camCaps.exposureCompensation.max);await applyRealCameraControl('exposureCompensation',P.ev)}
    syncPro();sceneReset();
  }catch(e){cameraReady=false;note('Không mở được camera: '+(e.name==='NotAllowedError'?'hãy cấp quyền camera.':e.message));console.error(e)}
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}cameraReady=false}
function setDigitalZoom(z){
  digital=clamp(z,1,5);applyView();
  if(hardwareZoom&&currentTrack)applyRealCameraControl('zoom',clamp(digital,camCaps.zoom.min,camCaps.zoom.max));
}
function cameraPointFocus(x,y){
  const ring=$('focusRing'),r=$('vf').getBoundingClientRect();
  ring.style.left=x+'px';ring.style.top=y+'px';ring.style.display='block';
  clearTimeout(cameraPointFocus.timer);cameraPointFocus.timer=setTimeout(()=>ring.style.display='none',900);
  if(currentTrack&&camCaps){
    const ax=camCaps.focusMode?.includes('single-shot')?'single-shot':null;
    if(ax)currentTrack.applyConstraints({advanced:[{focusMode:ax}]}).catch(()=>{});
  }
}
function bindCameraGestures(){
  const el=$('vf'),pts=new Map();let initial=1,startDist=0,lastTap=0;
  const dist=()=>{const p=[...pts.values()];return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)};
  el.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;
    el.setPointerCapture?.(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1){initial=digital;const now=Date.now();if(now-lastTap<320){}lastTap=now;}
    if(pts.size===2)startDist=dist();
  });
  el.addEventListener('pointermove',e=>{
    if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size>=2&&startDist>0)setDigitalZoom(initial*dist()/startDist);
  });
  const end=e=>{
    if(!pts.has(e.pointerId))return;const p=pts.get(e.pointerId);pts.delete(e.pointerId);
    if(pts.size===0&&p&&e.type==='pointerup'){
      const r=el.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      if(x>=0&&y>=0&&x<=r.width&&y<=r.height)cameraPointFocus(x,y);
    }
    if(pts.size<2)startDist=0;
  };
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
}
async function capturePhoto(){
  if(captureBusy)return;captureBusy=true;
  try{
    if(!cameraReady){note('Camera chưa sẵn sàng.');return}
    const delay=+$('captureTimer').value;
    if(delay){for(let n=delay;n>0;n--){note(`Chụp sau ${n}…`);await sleep(1000)}}
    const W=vid.videoWidth||demo.width,H=vid.videoHeight||demo.height,c=document.createElement('canvas');c.width=W;c.height=H;
    const ctx=c.getContext('2d');ctx.save();
    if(facing==='user'){ctx.translate(W,0);ctx.scale(-1,1)}
    ctx.drawImage(vid,0,0,W,H);ctx.restore();
    if(currentLook!=='natural'){const l=LOOKS[currentLook];ctx.save();ctx.globalCompositeOperation='source-over';ctx.filter=`${l.grayscale?'grayscale(1) ':''}${l.sepia?`sepia(${l.sepia}) `:''}${l.contrast?`contrast(${l.contrast}) `:''}${l.saturate?`saturate(${l.saturate})`:''}`;const tmp=document.createElement('canvas');tmp.width=W;tmp.height=H;tmp.getContext('2d').drawImage(c,0,0);ctx.clearRect(0,0,W,H);ctx.drawImage(tmp,0,0);ctx.restore();}
    const quality=+$('captureQuality').value,blob=await blobOf(c,quality),id=Date.now();
    const thumb=await thumbOf(blob);
    await dbPut({id,t:id,orig:blob,cur:blob,thumb,p:null,src:'camera',tags:[],scene:'',fav:false,ai:false});
    $('thumb').style.backgroundImage=`url(${URL.createObjectURL(thumb)})`;
    note('Đã chụp và lưu vào Thư viện.',true);loadGal();
    if(typeof autoTag==='function')autoTag(id);
  }catch(e){note('Lỗi chụp ảnh: '+e.message)}finally{captureBusy=false}
}

/* ---------- IndexedDB: lưu ảnh ngay trên thiết bị ---------- */
const DB_NAME='AICameraProDB',DB_VERSION=1,STORE='photos';let dbPromise=null;
function openDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:'id'});s.createIndex('t','t');}};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('Không mở được cơ sở dữ liệu.'));
  });return dbPromise;
}
async function dbPut(rec){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(rec);tx.oncomplete=()=>resolve(rec);tx.onerror=()=>reject(tx.error);});}
async function dbGet(id){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(Number(id));r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
async function dbAll(){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
async function dbDelete(id){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(Number(id));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}

/* ---------- Thư viện ảnh ---------- */
let galleryItems=[],viewerIndex=0,selectMode=false,selectedIds=new Set(),galleryFilter='all';
function fmtDate(t){return new Date(t).toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});}
function objectURL(blob){return URL.createObjectURL(blob)}
async function loadGal(){
  try{
    galleryItems=(await dbAll()).sort((a,b)=>b.t-a.t);
    const q=$('gQ').value.trim().toLowerCase(),items=galleryItems.filter(p=>{
      const f=galleryFilter==='all'||(galleryFilter==='fav'&&p.fav)||(galleryFilter==='ai'&&p.ai);
      const text=[p.scene,p.desc,...(p.tags||[])].join(' ').toLowerCase();return f&&(!q||text.includes(q));
    });
    $('galBody').innerHTML='';
    if(!items.length){$('galBody').innerHTML='<div class="empty">Chưa có ảnh phù hợp.<br>Hãy chụp ảnh hoặc nhập ảnh từ thiết bị.</div>';return}
    let last='';
    for(const p of items){
      const day=fmtDate(p.t);if(day!==last){const h=document.createElement('div');h.className='day';h.textContent=day;$('galBody').append(h);const g=document.createElement('div');g.className='grid';g.dataset.day=day;$('galBody').append(g);last=day;}
      const g=$('galBody').lastElementChild,cell=document.createElement('div');cell.dataset.id=p.id;
      const url=objectURL(p.thumb||p.cur||p.orig);cell.style.backgroundImage=`url("${url}")`;
      if(p.ai){const s=document.createElement('span');s.className='ai';s.textContent='✦ AI';cell.append(s)}
      if(selectMode&&selectedIds.has(p.id)){cell.classList.add('selected');const s=document.createElement('span');s.className='selmark';s.textContent='✓';cell.append(s)}
      cell.onclick=()=>selectMode?toggleSelected(p.id):openViewer(p.id);g.append(cell);
    }
    updateSelection();
  }catch(e){$('galBody').innerHTML=`<div class="empty">Lỗi tải thư viện: ${e.message}</div>`}
}
function toggleSelected(id){selectedIds.has(id)?selectedIds.delete(id):selectedIds.add(id);loadGal();}
function updateSelection(){$('galSelection').hidden=!selectMode;$('selCount').textContent=`${selectedIds.size} đã chọn`;$('bSelect').textContent=selectMode?'Hủy chọn':'Chọn';}
function openViewer(id){viewerIndex=galleryItems.findIndex(p=>p.id===id);if(viewerIndex<0)return;showViewer();}
function showViewer(){
  const p=galleryItems[viewerIndex];if(!p)return;
  $('vImg').src=objectURL(p.cur||p.orig);$('vInfo').textContent=`${fmtDate(p.t)}${p.fav?' · ♥':''}${p.ai?' · ✦ AI':''}`;
  $('vFav').textContent=p.fav?'♥':'♡';$('imgViewer').classList.add('on');$('imgViewer').setAttribute('aria-hidden','false');
}
function closeViewer(){$('imgViewer').classList.remove('on');$('imgViewer').setAttribute('aria-hidden','true');$('vImg').removeAttribute('src');}
async function viewerMove(d){viewerIndex=(viewerIndex+d+galleryItems.length)%galleryItems.length;showViewer();}
async function openStudio(id){
  const p=await dbGet(id);if(!p)return;
  cur=p;srcBmp=await bmp(p.cur||p.orig);cropR=null;E={};base=null;await buildBase();render();pushH(true);
  $('stEmpty').style.display='none';$('stk').style.display='block';go('stu');
}

/* ---------- Studio chỉnh sửa ---------- */
let cur=null,E={},base=null,preN=null,SL=[
  ['ex','Phơi sáng',-3,3,.05],['ct','Tương phản',-100,100,1],['hl','Vùng sáng',-100,100,1],['sh','Vùng tối',-100,100,1],
  ['tp','Nhiệt độ',-100,100,1],['sa','Bão hòa',-100,100,1],['vg','Tối góc',0,100,1],['nr','Giảm nhiễu',0,100,1],['sp','Độ nét',0,100,1],['cl','Độ rõ',-100,100,1]
];
let history=[],historyAt=-1;
function setE(o){E={...o};}
async function buildBase(){
  if(!srcBmp)return;
  const W=srcBmp.width,H=srcBmp.height,c=document.createElement('canvas');c.width=W;c.height=H;
  const ctx=c.getContext('2d');if(cropR){const [x,y,w,h]=cropR;ctx.drawImage(srcBmp,x*W,y*H,w*W,h*H,0,0,W,H)}else ctx.drawImage(srcBmp,0,0);
  base=ctx.getImageData(0,0,W,H);
}
function render(){
  if(!base)return;const c=$('cvA'),ctx=c.getContext('2d'),W=base.width,H=base.height;c.width=W;c.height=H;
  const image=new ImageData(new Uint8ClampedArray(base.data),W,H),d=image.data;
  const ex=Math.pow(2,E.ex||0),contrast=1+(E.ct||0)/180,sat=1+(E.sa||0)/100,temp=(E.tp||0)/220;
  for(let i=0;i<d.length;i+=4){
    let r=d[i]*ex,g=d[i+1]*ex,b=d[i+2]*ex;
    r=(r-128)*contrast+128+temp*24;g=(g-128)*contrast+128;b=(b-128)*contrast+128-temp*24;
    const y=.299*r+.587*g+.114*b;r=y+(r-y)*sat;g=y+(g-y)*sat;b=y+(b-y)*sat;
    d[i]=clamp(r,0,255);d[i+1]=clamp(g,0,255);d[i+2]=clamp(b,0,255);
  }
  ctx.putImageData(image,0,0);
  $('tagA').style.display='block';$('tagB').style.display='none';$('cvO').style.display='none';
}
function pushH(initial=false){
  if(initial){history=[];historyAt=-1;}
  const snap={E:{...E},cropR:cropR?[...cropR]:null};history=history.slice(0,historyAt+1);history.push(snap);historyAt=history.length-1;
  $('sUndo').disabled=historyAt<=0;$('sRedo').disabled=true;
}
async function restoreHistory(i){if(i<0||i>=history.length)return;historyAt=i;E={...history[i].E};cropR=history[i].cropR?[...history[i].cropR]:null;await buildBase();render();$('sUndo').disabled=historyAt<=0;$('sRedo').disabled=historyAt>=history.length-1;}
async function saveStudio(){
  if(!cur||!base)return;const c=$('cvA'),blob=await blobOf(c,.96),thumb=await thumbOf(blob),rec={...cur,cur:blob,thumb,p:Date.now()};
  await dbPut(rec);cur=rec;note('');$('gMsg').textContent='Đã lưu bản chỉnh vào Thư viện.';loadGal();
}
async function downloadStudio(){
  if(!cur)return;const blob=await blobOf($('cvA'),.96),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`AI-Camera-Pro-${Date.now()}.jpg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function compareStudio(){
  if(!cur)return;const on=$('cvO').style.display!=='none';
  if(on){$('cvO').style.display='none';$('tagB').style.display='none';return}
  const im=await bmp(cur.orig);const c=$('cvO');c.width=im.width;c.height=im.height;c.getContext('2d').drawImage(im,0,0);c.style.display='block';$('tagB').style.display='block';
}
function buildSliders(){
  const groups={slL:['ex','hl','sh'],slC:['ct','tp','sa','vg'],slD:['nr','sp','cl']};
  for(const [id,keys] of Object.entries(groups)){
    $(id).innerHTML='';
    keys.forEach(k=>{
      const s=SL.find(x=>x[0]===k),row=document.createElement('div');row.className='sl';
      row.innerHTML=`<span>${s[1]}</span><output id="out-${k}">0</output><input type="range" min="${s[2]}" max="${s[3]}" step="${s[4]}" value="0">`;
      const input=row.querySelector('input'),out=row.querySelector('output');
      row.onclick=()=>row.classList.toggle('open');
      input.oninput=e=>{E[k]=Number(e.target.value);out.textContent=e.target.value;render()};
      input.onchange=()=>pushH();$(id).append(row);
    });
  }
}

/* ---------- Điều hướng, nhập/xuất, cài đặt ---------- */
function go(tab){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.id===`t-${tab}`));
  document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.t===tab));
  if(tab==='gal')loadGal();if(tab==='stu'&&!cur){$('stEmpty').style.display='block';$('stk').style.display='none';}
}
function closeSettings(){$('camSettings').classList.remove('on');$('camSettings').setAttribute('aria-hidden','true');}
function openSettings(){$('camSettings').classList.add('on');$('camSettings').setAttribute('aria-hidden','false');}
async function importFiles(files){
  for(const f of files){if(!f.type.startsWith('image/'))continue;const id=Date.now()+Math.floor(Math.random()*1000),thumb=await thumbOf(f);await dbPut({id,t:id,orig:f,cur:f,thumb,tags:[],scene:'',fav:false,ai:false,src:'import'});}
  loadGal();
}
async function exportLibrary(){
  const all=await dbAll(),data=[];
  for(const p of all){data.push({id:p.id,t:p.t,fav:!!p.fav,ai:!!p.ai,scene:p.scene||'',tags:p.tags||[],blob:p.cur||p.orig});}
  // Xuất từng ảnh riêng để tránh tạo một gói ZIP không có thư viện phụ thuộc.
  for(const p of data){const u=URL.createObjectURL(p.blob),a=document.createElement('a');a.href=u;a.download=`AI-Camera-${p.id}.jpg`;a.click();await sleep(180);URL.revokeObjectURL(u);}
}
function bindEvents(){
  document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>go(b.dataset.t));
  document.querySelectorAll('#modes b').forEach(b=>b.onclick=()=>setMode(b.dataset.m));
  $('shut').onclick=capturePhoto;
  $('flip').onclick=async()=>{facing=facing==='environment'?'user':'environment';await startCamera();};
  $('bFlash').onclick=async()=>{flashOn=!flashOn;try{await currentTrack?.applyConstraints({advanced:[{torch:flashOn}]});$('bFlash').textContent=flashOn?'⚡ Bật':'⚡ Tắt';}catch(_){flashOn=false;note('Thiết bị/trình duyệt không hỗ trợ đèn flash.')}};
  $('bGrid').onclick=()=>{gridOn=!gridOn;$('bGrid').classList.toggle('on',gridOn);drawOverlay()};
  $('bRes').onclick=()=>note('Độ phân giải phụ thuộc camera và trình duyệt đang cấp quyền.');
  $('bAI').onclick=()=>{aiOn=!aiOn;$('bAI').textContent=aiOn?'✨ AI: Bật':'✨ AI: Tắt';$('bAI').classList.toggle('on',aiOn);if(!aiOn){$('sug').style.display='none';$('sugBtn').style.display='none';$('scene').style.display='none'}else{sceneReset()}};
  $('bSettings').onclick=openSettings;$('settingsClose').onclick=closeSettings;
  $('camSettings').onclick=e=>{if(e.target===$('camSettings'))closeSettings()};
  $('captureTimer').onchange=()=>localStorage.setItem('captureTimer',$('captureTimer').value);
  $('captureQuality').onchange=()=>localStorage.setItem('captureQuality',$('captureQuality').value);
  $('uiTheme').onchange=()=>{document.body.dataset.theme=$('uiTheme').value;localStorage.setItem('uiTheme',$('uiTheme').value)};
  $('captureTimer').value=localStorage.getItem('captureTimer')||'0';$('captureQuality').value=localStorage.getItem('captureQuality')||'.95';
  $('uiTheme').value=localStorage.getItem('uiTheme')||'dark';document.body.dataset.theme=$('uiTheme').value;
  $('lookRow').onclick=e=>{const b=e.target.closest('[data-look]');if(!b)return;currentLook=b.dataset.look;document.querySelectorAll('.look-chip').forEach(x=>x.classList.toggle('on',x===b));drawOverlay()};
  $('pEV').oninput=async()=>{P.ev=+$('pEV').value;syncPro();if(hardwareEV)await applyRealCameraControl('exposureCompensation',P.ev);};
  $('pEV').onchange=()=>note('EV '+P.ev.toFixed(1));
  $('pISO').oninput=()=>{P.iso=+$('pISO').value;syncPro()};$('pWB').oninput=()=>{P.wb=+$('pWB').value;syncPro()};$('pCT').oninput=()=>{P.ct=+$('pCT').value;syncPro()};
  document.querySelectorAll('[data-pro]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-pro]').forEach(x=>x.classList.toggle('on',x===b));const k=b.dataset.pro,ids={ev:'pEV',iso:'pISO',wb:'pWB',ct:'pCT'};document.querySelectorAll('#proAdjust .sl').forEach(x=>x.hidden=true);if(ids[k])$(ids[k]).closest('.sl').hidden=false;$('proLabel').textContent=b.querySelector('small').textContent;});
  $('bSelect').onclick=()=>{selectMode=!selectMode;selectedIds.clear();updateSelection();loadGal()};
  $('selCancel').onclick=()=>{selectMode=false;selectedIds.clear();loadGal()};
  $('selDelete').onclick=async()=>{if(!selectedIds.size||!confirm(`Xóa ${selectedIds.size} ảnh đã chọn?`))return;for(const id of selectedIds)await dbDelete(id);selectedIds.clear();loadGal()};
  $('selFav').onclick=async()=>{for(const id of selectedIds){const p=await dbGet(id);if(p){p.fav=true;await dbPut(p)}}selectedIds.clear();loadGal()};
  $('galFilters').onclick=e=>{const b=e.target.closest('[data-filter]');if(!b)return;galleryFilter=b.dataset.filter;document.querySelectorAll('#galFilters .chip').forEach(x=>x.classList.toggle('on',x===b));loadGal()};
  $('gQ').oninput=loadGal;
  $('bImp').onclick=()=>$('fImp').click();$('fImp').onchange=async()=>{await importFiles([...$('fImp').files]);$('fImp').value=''};
  $('bExp').onclick=exportLibrary;$('bGenNew').onclick=()=>go('ai');
  $('vClose').onclick=closeViewer;$('imgViewer').onclick=e=>{if(e.target===$('imgViewer'))closeViewer()};
  $('vPrev').onclick=()=>viewerMove(-1);$('vNext').onclick=()=>viewerMove(1);
  $('vFav').onclick=async()=>{const p=galleryItems[viewerIndex];if(!p)return;p.fav=!p.fav;await dbPut(p);galleryItems[viewerIndex]=p;showViewer();loadGal()};
  $('vEdit').onclick=()=>{const p=galleryItems[viewerIndex];if(p)openStudio(p.id);closeViewer()};
  $('sSave').onclick=saveStudio;$('sDl').onclick=downloadStudio;$('sCmp').onclick=compareStudio;
  $('sRst').onclick=async()=>{if(!cur)return;E={};cropR=null;await buildBase();render();pushH();};
  $('sUndo').onclick=()=>restoreHistory(historyAt-1);$('sRedo').onclick=()=>restoreHistory(historyAt+1);
  $('cmpR').oninput=()=>{}; // Dành chỗ cho thanh so sánh kéo ở bản nâng cấp.
  window.addEventListener('resize',resizeOverlay);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeViewer();closeSettings()}});
}
async function initApp(){
  buildSliders();bindEvents();bindCameraGestures();syncPro();
  try{await openDB();await loadGal()}catch(e){console.error(e);note('Không khởi tạo được thư viện: '+e.message)}
  await startCamera();
  initAI();
  // AI cục bộ chỉ phân tích khi người dùng bật AI; không gửi ảnh lên mạng.
  setInterval(async()=>{
    if(!aiOn||!cameraReady||!stream)return;
    try{await detect();suggest();sceneStep()}catch(e){console.warn('AI local:',e)}
  },1100);
}
window.addEventListener('DOMContentLoaded',initApp);

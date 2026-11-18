/* =====================================================================
   app.js — Giao diện & logic chính: tab, IndexedDB, camera, chụp, thư viện, studio
   Nạp SAU ai-engine.js (file đó khai báo phần AI; initAI() được gọi ở cuối file này).
   ===================================================================== */
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/* ---------- Tab ---------- */
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,.tab').forEach(e=>e.classList.remove('on'));b.classList.add('on');$('t-'+b.dataset.t).classList.add('on');if(b.dataset.t==='gal')loadGal();if(b.dataset.t!=='cam'&&stream){stream.getTracks().forEach(t=>t.stop());stream=null;track=null;vid.srcObject=null;vid.style.display='none';demo.style.display='block'}if(b.dataset.t==='cam'&&!stream&&navigator.mediaDevices?.getUserMedia)startCam()});
const go=t=>document.querySelector(`nav [data-t=${t}]`).click();

/* ---------- IndexedDB ---------- */
let db;const dbp=new Promise((resolve,reject)=>{const q=indexedDB.open('aps',1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('p'))q.result.createObjectStore('p',{keyPath:'id'})};q.onsuccess=()=>{db=q.result;db.onversionchange=()=>db.close();resolve()};q.onerror=()=>reject(q.error||new Error('Không mở được IndexedDB'));q.onblocked=()=>reject(new Error('Cơ sở dữ liệu đang bị chặn bởi tab khác'))});
const tx=(m,f)=>dbp.then(()=>new Promise((resolve,reject)=>{let result;const t=db.transaction('p',m),s=t.objectStore('p');try{const q=f(s);if(q)q.onsuccess=()=>{result=q.result};}catch(e){reject(e);return}t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error||new Error('Lỗi cơ sở dữ liệu'));t.onabort=()=>reject(t.error||new Error('Giao dịch bị hủy'))}));
const dbAll=()=>tx('readonly',s=>s.getAll()),dbPut=o=>tx('readwrite',s=>s.put(o)),dbGet=i=>tx('readonly',s=>s.get(i));
const thumbOf=async b=>{const im=await bmp(b),c=document.createElement('canvas'),k=300/Math.max(im.width,im.height);c.width=im.width*k;c.height=im.height*k;c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.7)};
const bmp=b=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=URL.createObjectURL(b)});
const blobOf=(c,q=.93)=>new Promise(r=>c.toBlob(r,'image/jpeg',q));

/* ---------- Cài đặt Camera ---------- */
function readSetting(k,d){try{return localStorage.getItem('cam_'+k)??d}catch(_){return d}}
function saveSetting(k,v){try{localStorage.setItem('cam_'+k,String(v))}catch(_){}}
$('captureTimer').value=readSetting('timer','0');
$('captureQuality').value=readSetting('quality','0.95');
$('captureFrame').value=readSetting('frame','none');
$('captureStamp').checked=readSetting('stamp','false')==='true';
$('uiTheme').value=readSetting('theme','dark');
document.body.dataset.theme=$('uiTheme').value;
$('bSettings').onclick=()=>{$('camSettings').classList.add('on');$('camSettings').setAttribute('aria-hidden','false')};
function closeSettings(){$('camSettings').classList.remove('on');$('camSettings').setAttribute('aria-hidden','true')}
$('settingsClose').onclick=closeSettings;
$('camSettings').addEventListener('click',e=>{if(e.target===$('camSettings'))closeSettings()});
[['captureTimer','timer'],['captureQuality','quality'],['captureFrame','frame']].forEach(([id,k])=>$(id).onchange=()=>saveSetting(k,$(id).value));
$('captureStamp').onchange=()=>saveSetting('stamp',$('captureStamp').checked);
$('uiTheme').onchange=()=>{document.body.dataset.theme=$('uiTheme').value;saveSetting('theme',$('uiTheme').value)};
function decorateCapture(canvas){
 const frame=$('captureFrame').value,stamp=$('captureStamp').checked;
 if(frame==='none'&&!stamp)return canvas;
 const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;
 const x=c.getContext('2d');x.drawImage(canvas,0,0);
 const m=Math.max(10,Math.round(Math.min(c.width,c.height)*.018));
 if(frame==='classic'){x.strokeStyle='#f5f0e6';x.lineWidth=m;x.strokeRect(m/2,m/2,c.width-m,c.height-m)}
 if(frame==='film'){x.fillStyle='#111';x.fillRect(0,0,c.width,m*2);x.fillRect(0,c.height-m*2,c.width,m*2);x.fillStyle='#f3e8d1';for(let xx=m;xx<c.width-m;xx+=m*1.6){x.fillRect(xx,m*.55,m*.55,m*.8);x.fillRect(xx,c.height-m*1.35,m*.55,m*.8)}}
 if(frame==='clean'){x.strokeStyle='#fff';x.lineWidth=Math.max(2,m*.16);x.strokeRect(m,m,c.width-2*m,c.height-2*m)}
 if(stamp){const h=Math.max(28,Math.round(c.width*.035));x.fillStyle='#0009';x.fillRect(0,c.height-h,c.width,h);x.fillStyle='#fff';x.font=`${Math.max(12,Math.round(h*.38))}px system-ui`;x.textBaseline='middle';x.fillText(`AI CAMERA PRO  ·  ${facing==='environment'?'REAR':'FRONT'}  ·  ${mode.toUpperCase()}  ·  ${c.width}×${c.height}  ·  ${new Date().toLocaleDateString('vi-VN')}`,Math.max(8,m/2),c.height-h/2)}
 return c;
}

/* ---------- CAMERA ---------- */
const vid=$('vid'),demo=$('demo'),ov=$('ov');
const RES={FHD:{w:1920,h:1080,cap:1920},'4K':{w:3840,h:2160,cap:3840},'8K':{w:7680,h:4320,cap:7680}};
let stream,track,ic,photoCaps,camCaps={},hardwareEV=false,facing='environment',lenses=[],curLens=1,digital=1,mode='photo',aiOn=false,gridOn=true,P={ev:0,iso:100,wb:5500,ct:0},activeLook='natural',resK=RES[localStorage.getItem('res')]?localStorage.getItem('res'):'4K',baseNote='';
const note=t=>$('camNote').textContent=t;
$('bRes').textContent='📐 '+resK;$('bRes').onclick=()=>{resK=resK==='FHD'?'4K':resK==='4K'?'8K':'FHD';localStorage.setItem('res',resK);$('bRes').textContent='📐 '+resK;if(stream)startCam()};

function readCameraCaps(){
 try{camCaps=track&&track.getCapabilities?track.getCapabilities():{}}catch(_){camCaps={}}
 const rows=[['pEV','oEV','exposureCompensation','EV'],['pISO','oISO','iso','ISO'],['pWB','oWB','colorTemperature','WB']];
 hardwareEV=!!camCaps.exposureCompensation;
 rows.forEach(([input,out,key,label])=>{
  const el=$(input),cap=camCaps[key],supported=!!(cap&&typeof cap.min==='number'&&typeof cap.max==='number');
  el.disabled=!supported;
  el.title=supported?`${label} phần cứng: ${cap.min}–${cap.max}`:`Thiết bị/trình duyệt không hỗ trợ điều khiển ${label} thật`;
  if(supported){el.min=cap.min;el.max=cap.max;if(key==='exposureCompensation')el.step=cap.step||.1;else el.step=key==='iso'?Math.max(1,cap.step||50):Math.max(50,cap.step||100);
   P[key==='exposureCompensation'?'ev':key==='iso'?'iso':'wb']=clamp(P[key==='exposureCompensation'?'ev':key==='iso'?'iso':'wb'],cap.min,cap.max);
  }
  $(out).textContent=el.disabled?'N/A':String(P[key==='exposureCompensation'?'ev':key==='iso'?'iso':'wb']);
 });
 // Sửa lỗi: dựng lại từ baseNote thay vì nối dài mỗi lần mở camera
 note(`${baseNote} · Điều khiển thật: EV ${hardwareEV?'có':'không'}, ISO ${camCaps.iso?'có':'không'}, WB ${camCaps.colorTemperature?'có':'không'}`);
 syncPro();
 if(camCaps.iso)applyRealCameraControl('iso',P.iso);
 if(camCaps.colorTemperature)applyRealCameraControl('colorTemperature',P.wb);
 if(hardwareEV)applyRealCameraControl('exposureCompensation',P.ev);
}
async function applyRealCameraControl(key,value){
 if(!track||!camCaps[key])return false;
 try{await track.applyConstraints({advanced:[{[key]:value}]});return true}catch(_){return false}
}

let tt=0;setInterval(()=>{if(stream)return;const c=demo.getContext('2d'),w=480,h=640,g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#5b8def');g.addColorStop(.55,'#ffb27a');g.addColorStop(1,'#2d3b2a');c.fillStyle=g;c.fillRect(0,0,w,h);const x=170+Math.sin(tt)*50;c.fillStyle='#e8d7c3';c.beginPath();c.arc(x,260,38,0,7);c.fill();c.fillRect(x-30,300,60,150);c.fillStyle='#222';c.beginPath();c.arc(x-12,254,4,0,7);c.arc(x+12,254,4,0,7);c.fill();tt+=.04},60);
async function startCam(){try{stream&&stream.getTracks().forEach(t=>t.stop());F.on=false;sg.p=null;sg.hold=0;const R=RES[resK];
 stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing,width:{ideal:R.w},height:{ideal:R.h}},audio:false});
 vid.srcObject=stream;await vid.play();vid.style.display='block';demo.style.display='none';track=stream.getVideoTracks()[0];
 ic=window.ImageCapture?new ImageCapture(track):null;photoCaps=null;if(ic)try{photoCaps=await ic.getPhotoCapabilities()}catch(_){}
 await detectLenses();const st=track.getSettings(),actualW=st.width||vid.videoWidth,actualH=st.height||vid.videoHeight;
 const hi=photoCaps&&photoCaps.imageWidth&&photoCaps.imageHeight?` · ảnh tĩnh tối đa ${photoCaps.imageWidth.max}×${photoCaps.imageHeight.max}`:'';
 const meets=Math.max(actualW,actualH)>=R.w&&Math.min(actualW,actualH)>=R.h;
 baseNote=`Yêu cầu ${resK} · luồng thực tế ${actualW}×${actualH}${hi}${meets?'':' · camera không đạt độ phân giải yêu cầu'}`;note(baseNote);readCameraCaps()}
 catch(e){note('Không mở được camera (quyền bị chặn?). Đang dùng cảnh mẫu – bạn vẫn có thể thử khung hình AI.')}}
async function detectLenses(){const devs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'),cap=track.getCapabilities?track.getCapabilities():{};
 const find=re=>devs.find(d=>re.test(d.label));const uw=find(/ultra|0\.5|0,5/i),tele=find(/tele|3x|5x|zoom/i);
 lenses=[];if(uw)lenses.push({z:.6,dev:uw.deviceId,t:'0.6'});lenses.push({z:1,t:'1×'});
 const hz=cap.zoom?cap.zoom.max:1;
 [2,3,5].forEach(z=>{if(z===3&&tele)lenses.push({z:3,dev:tele.deviceId,t:'3×',tele:1});else lenses.push({z,hw:hz>=z,t:z+'×'})});
 $('lens').innerHTML=lenses.map((l,i)=>`<button data-i="${i}" class="${l.z===1?'on':''}">${l.t}</button>`).join('')}
$('lens').onclick=async e=>{const i=e.target.dataset.i;if(i==null)return;const l=lenses[i];document.querySelectorAll('#lens button').forEach(b=>b.classList.toggle('on',b===e.target));curLens=l.z;digital=1;F.on=false;sg.p=null;pinchStart=0;pinchZoom=1;
 if(stream&&l.dev){try{stream.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:l.dev},width:{ideal:RES[resK].w},height:{ideal:RES[resK].h}}});vid.srcObject=stream;vid.play().catch(()=>{});track=stream.getVideoTracks()[0];ic=window.ImageCapture?new ImageCapture(track):null;photoCaps=null;ic&&ic.getPhotoCapabilities().then(c=>photoCaps=c).catch(()=>{});$('camNote').textContent='Dùng ống kính '+l.t+' (phần cứng)';return}catch(_){}}
 if(l.z<1){digital=1;$('camNote').textContent='Máy không có góc siêu rộng – dùng 1×';return}
 if(l.z>1){if(l.hw&&track){try{await track.applyConstraints({advanced:[{zoom:l.z}]});$('camNote').textContent='Zoom quang/phần cứng '+l.t;return}catch(_){}}
  digital=l.z;$('camNote').textContent=l.tele?'':'Máy không có tele → zoom số '+l.t+' (cắt khung, chất lượng giảm)'}else $('camNote').textContent='';
 applyView()};
function applyView(){
 const evFallback=hardwareEV?1:Math.pow(2,P.ev);
 const f=`brightness(${evFallback}) contrast(${1+P.ct/100})`;
 const looks={natural:'none',cinema:'contrast(1.18) saturate(1.12) sepia(.08)',warm:'sepia(.18) saturate(1.25) contrast(1.04)',moody:'contrast(1.28) saturate(.78) brightness(.92)',vintage:'sepia(.28) contrast(.92) saturate(.82)',mono:'grayscale(1) contrast(1.12)'};
 const look=looks[activeLook]||'none';
 [vid,demo].forEach(e=>{e.style.filter=`${f} ${look}`});
}
const lookFilters={natural:'none',cinema:'contrast(1.18) saturate(1.12) sepia(.08)',warm:'sepia(.18) saturate(1.25) contrast(1.04)',moody:'contrast(1.28) saturate(.78) brightness(.92)',vintage:'sepia(.28) contrast(.92) saturate(.82)',mono:'grayscale(1) contrast(1.12)'};
document.querySelectorAll('.look-chip').forEach(b=>b.onclick=()=>{activeLook=b.dataset.look;document.querySelectorAll('.look-chip').forEach(x=>x.classList.toggle('on',x===b));applyView()});
function setDigitalZoom(v){
 const next=clamp(+v,1,5);
 if(Math.abs(next-digital)<.015)return;
 digital=next;F.on=false;sg.p=null;sg.hold=0;sg.until=0;
 $('camNote').textContent='Zoom '+digital.toFixed(1)+'×';
}
let pinchStart=0,pinchZoom=1,pointers=new Map(),pinching=false;
const vf=$('vf');
vf.addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse'&&e.button!==0)return;
 if(e.target.closest('button,.pill,.lens,.ctrl,.scene,.sugbtn'))return;
 e.preventDefault();
 pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 try{vf.setPointerCapture(e.pointerId)}catch(_){}
 if(pointers.size===2){const a=[...pointers.values()];pinchStart=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);pinchZoom=digital;pinching=true;}
},{passive:false});
vf.addEventListener('pointermove',e=>{
 if(!pointers.has(e.pointerId))return;
 e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pointers.size>=2&&pinchStart>0){const a=[...pointers.values()];const dist=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);setDigitalZoom(pinchZoom*dist/pinchStart);}
},{passive:false});
['pointerup','pointercancel','lostpointercapture'].forEach(n=>vf.addEventListener(n,e=>{pointers.delete(e.pointerId);if(pointers.size<2){pinchStart=0;pinching=false;}},{passive:true}));

/* Chạm để lấy nét */
let focusTimer=0;
async function focusAt(ev){
 if(!stream||!track||!vid.videoWidth||pointers.size>1)return;
 if(ev.target.closest('button,.sugbtn,.top,.lens,.ctrl,.scene'))return;
 const rect=ov.getBoundingClientRect(),px=ev.clientX-rect.left,py=ev.clientY-rect.top;
 const ring=$('focusRing');ring.style.left=px+'px';ring.style.top=py+'px';ring.style.display='block';
 ring.style.animation='none';void ring.offsetWidth;ring.style.animation='';
 clearTimeout(focusTimer);focusTimer=setTimeout(()=>ring.style.display='none',1100);
 const c=cover(vid);
 const ux=(px-V.tx)/V.z,uy=(py-V.ty)/V.z;
 const nx=clamp((ux+c.ox)/(c.W*c.r),0,1),ny=clamp((uy+c.oy)/(c.H*c.r),0,1);
 let caps={};try{caps=track.getCapabilities?track.getCapabilities():{}}catch(_){}
 const advanced={};
 if(caps.pointsOfInterest)advanced.pointsOfInterest=[{x:nx,y:ny}];
 if(caps.focusMode&&caps.focusMode.includes('single-shot'))advanced.focusMode='single-shot';
 else if(caps.focusMode&&caps.focusMode.includes('continuous'))advanced.focusMode='continuous';
 if(Object.keys(advanced).length){
  try{await track.applyConstraints({advanced:[advanced]});note('Đã lấy nét tại vị trí bạn chạm');}
  catch(_){note('Thiết bị không cho phép điều khiển lấy nét bằng trình duyệt');}
 }else note('Đã chọn điểm lấy nét · chế độ tự động của camera đang hoạt động');
}
$('vf').addEventListener('pointerdown',focusAt,{passive:true});

$('flip').onclick=()=>{facing=facing==='environment'?'user':'environment';startCam()};
$('bFlash').onclick=async e=>{const on=e.target.dataset.on!=='1';try{await track.applyConstraints({advanced:[{torch:on}]});e.target.dataset.on=on?1:0;e.target.textContent=on?'⚡ Bật':'⚡ Tắt'}catch(_){e.target.textContent='⚡ N/A'}};
$('bGrid').onclick=()=>{gridOn=!gridOn};$('bAI').onclick=e=>{aiOn=!aiOn;F.on=false;sg.p=null;sg.q=null;sg.hold=0;sg.until=0;subj=null;e.target.classList.toggle('on',aiOn);e.target.textContent='✨ AI: '+(aiOn?'Bật':'Tắt');ui('✨ AI đang tìm chủ thể…',false);sceneReset()};
$('modes').onclick=e=>{const m=e.target.dataset.m;if(!m)return;mode=m;document.querySelectorAll('#modes b').forEach(b=>b.classList.toggle('on',b===e.target));$('pro').classList.toggle('on',m==='pro');
 const pre={photo:[0,100,5500,0],portrait:[.2,100,5800,8],night:[0,100,5200,0],pro:[P.ev,P.iso,P.wb,P.ct]}[m];[P.ev,P.iso,P.wb,P.ct]=pre;syncPro();applyView();
 if(camCaps.iso)applyRealCameraControl('iso',P.iso);
 if(camCaps.colorTemperature)applyRealCameraControl('colorTemperature',P.wb);
 if(hardwareEV)applyRealCameraControl('exposureCompensation',m==='night'?Math.min(camCaps.exposureCompensation.max,1.5):(m==='pro'?P.ev:0));
 note(m==='night'?'Chụp đêm: giữ máy yên ~2 giây, máy gộp nhiều khung để giảm nhiễu':baseNote)};
const prs=[['pEV','ev','oEV',v=>(+v).toFixed(1)],['pISO','iso','oISO',v=>v],['pWB','wb','oWB',v=>v],['pCT','ct','oCT',v=>v]];
let activePro='ev';
const proMeta={ev:['Bù phơi sáng (EV)','EV'],iso:['Độ nhạy sáng (ISO)','ISO'],wb:['Cân bằng trắng (K)','WB'],ct:['Tương phản','CONTRAST']};
function syncPro(){prs.forEach(([i,k,o,f])=>{$(i).value=P[k];$(o).textContent=$(i).disabled?'N/A':f(P[k])});$('pvEV').textContent=hardwareEV?P.ev.toFixed(1):P.ev.toFixed(1)+'*';$('pvISO').textContent=camCaps.iso?P.iso:'Auto';$('pvWB').textContent=camCaps.colorTemperature?P.wb+'K':'Auto';$('pvCT').textContent=P.ct;$('proSupport').textContent=`EV ${hardwareEV?'✓':'*'} · ISO ${camCaps.iso?'✓':'—'} · WB ${camCaps.colorTemperature?'✓':'—'}`;selectPro(activePro)}
function selectPro(k){activePro=k;const map={ev:'pEV',iso:'pISO',wb:'pWB',ct:'pCT'};const id=map[k];document.querySelectorAll('.pro-param').forEach(b=>b.classList.toggle('on',b.dataset.pro===k));if(!id){document.querySelectorAll('#proAdjust .sl').forEach(row=>row.hidden=true);$('proLabel').textContent=k==='shutter'?'Tốc độ màn trập':'Lấy nét';$('proValue').textContent='Auto';$('proHint').textContent='Trình duyệt/thiết bị hiện tại chưa cung cấp điều khiển thủ công ổn định cho thông số này.';return}document.querySelectorAll('#proAdjust .sl').forEach(row=>row.hidden=!row.querySelector('#'+id));$('proLabel').textContent=proMeta[k][0];$('proValue').textContent=$(id).disabled?'N/A':$(id).value;$('proHint').textContent=({ev:hardwareEV?'Điều khiển bù phơi sáng của camera.':'EV phần cứng không hỗ trợ; giá trị này chỉ áp dụng cho xử lý khung chụp nếu có.',iso:camCaps.iso?'ISO được camera hỗ trợ.':'Thiết bị/trình duyệt không hỗ trợ ISO thủ công.',wb:camCaps.colorTemperature?'Nhiệt độ màu được camera hỗ trợ.':'Thiết bị/trình duyệt không hỗ trợ WB thủ công.',ct:'Tương phản được áp dụng trong xử lý ảnh sau khi chụp.'})[k];}
document.querySelectorAll('.pro-param').forEach(b=>b.onclick=()=>{const k=b.dataset.pro;if(k==='shutter'||k==='focus'){ $('proLabel').textContent=k==='shutter'?'Tốc độ màn trập':'Lấy nét';$('proValue').textContent='Auto';$('proHint').textContent='Trình duyệt hiện tại chưa cung cấp điều khiển thủ công ổn định cho thông số này. Không hiển thị thanh kéo giả.';document.querySelectorAll('.pro-param').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('#proAdjust .sl').forEach(x=>x.hidden=true);activePro=k;return}selectPro(k)});
prs.forEach(([i,k,o,f])=>$(i).oninput=async()=>{
 P[k]=+$(i).value;$(o).textContent=f(P[k]);$('proValue').textContent=f(P[k]);$('pv'+({ev:'EV',iso:'ISO',wb:'WB',ct:'CT'}[k])).textContent=k==='wb'?P[k]+'K':f(P[k]);
 if(k==='ev'){if(hardwareEV){const ok=await applyRealCameraControl('exposureCompensation',P.ev);if(!ok){hardwareEV=false;$(i).disabled=true;$(o).textContent='N/A';note('Camera từ chối EV phần cứng; EV sẽ dùng xử lý ảnh dự phòng')}}applyView()}
 if(k==='iso'){const ok=await applyRealCameraControl('iso',P.iso);if(!ok){$(i).disabled=true;$(o).textContent='N/A';note('Thiết bị không cho phép chỉnh ISO thủ công')}}
 if(k==='wb'){const ok=await applyRealCameraControl('colorTemperature',P.wb);if(!ok){$(i).disabled=true;$(o).textContent='N/A';note('Thiết bị không cho phép chỉnh nhiệt độ màu thủ công')}}
});
const src=()=>stream?vid:demo;

/* Chuyển khung mượt tới đích (state F, V, T nằm trong ai-engine.js) */
function step(){const w=ov.width,h=ov.height;if(F.on){T.z=F.z;T.tx=F.tx;T.ty=F.ty}else{T.z=digital;T.tx=w*(1-digital)/2;T.ty=h*(1-digital)/2}
 let c=0;for(const p of['z','tx','ty']){const d=T[p]-V[p];if(Math.abs(d)>(p==='z'?.002:.3)){V[p]+=d*.12;c=1}}
 if(c||!V.init){V.init=1;const mediaTransform=`translate(${V.tx}px,${V.ty}px) scale(${V.z})`;vid.style.transform=mediaTransform;demo.style.transform=mediaTransform;}}
function crop(s){const W=s.videoWidth||480,H=s.videoHeight||640,r=Math.max(ov.width/W,ov.height/H),ox=(W*r-ov.width)/2,oy=(H*r-ov.height)/2,z=V.z;return[(-V.tx/z+ox)/r,(-V.ty/z+oy)/r,ov.width/z/r,ov.height/z/r]}
/* Vòng lặp AI: chỉ chạy khi bật AI, tạm dừng khi ẩn tab */
(async function loop(){const t0=performance.now();if(aiOn&&!document.hidden&&$('t-cam').classList.contains('on')){try{await detect();suggest();sceneStep()}catch(_){}}setTimeout(loop,Math.max(220,(performance.now()-t0)*3))})();
function drawOv(){const c=ov.getContext('2d'),r=ov.getBoundingClientRect();if(ov.width!==r.width)ov.width=r.width,ov.height=r.height;const w=ov.width,h=ov.height;c.clearRect(0,0,w,h);
 if(gridOn){c.strokeStyle='#fff5';c.lineWidth=1;c.beginPath();[1,2].forEach(i=>{c.moveTo(w*i/3,0);c.lineTo(w*i/3,h);c.moveTo(0,h*i/3);c.lineTo(w,h*i/3)});c.stroke()}
 const X=x=>x*V.z+V.tx,Y=y=>y*V.z+V.ty;
 if(aiOn&&subj){const b=subj.box;c.strokeStyle=subj.kind==='khuôn mặt'?'#34d399':'#ff7a1a';c.lineWidth=2;c.strokeRect(X(b.x),Y(b.y),b.w*V.z,b.h*V.z);
  if(subj.eyes)subj.eyes.forEach(p=>{c.beginPath();c.arc(X(p.x),Y(p.y),4,0,7);c.fillStyle='#34d399';c.fill()})}
 if(aiOn&&sg.p){const p=sg.p;c.setLineDash([8,6]);c.strokeStyle='#ff7a1a';c.lineWidth=2.5;c.strokeRect(X(-p.tx/p.z),Y(-p.ty/p.z),w/p.z*V.z,h/p.z*V.z);c.setLineDash([])}
 if($('pro').classList.contains('on')){sx.filter='none';sx.drawImage(src(),0,0,96,128);const d=sx.getImageData(0,0,96,128).data,H=new Array(48).fill(0);for(let i=0;i<d.length;i+=4)H[(.3*d[i]+.59*d[i+1]+.11*d[i+2])*47/255|0]++;const hc=$('hist').getContext('2d'),m=Math.max(...H);hc.clearRect(0,0,300,42);hc.fillStyle='#ddd';H.forEach((v,i)=>hc.fillRect(i*6.25,42-v/m*40,5,v/m*40))}
 step();requestAnimationFrame(drawOv)}drawOv();

/* ---------- Xử lý ảnh thuần: căn chỉnh khung, xếp chồng, giảm nhiễu ---------- */
/*PURE-START*/
function lumaGrid(d,w,h,ds){const gw=(w/ds)|0,gh=(h/ds)|0,g=new Float32Array(gw*gh),o=[ds/6|0,ds/2|0,ds*5/6|0];
 for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){let a=0;for(const j of o)for(const i of o){const p=((y*ds+j)*w+x*ds+i)<<2;a+=.3*d[p]+.59*d[p+1]+.11*d[p+2]}g[y*gw+x]=a/9}
 return{g,gw,gh}}
function align1(A,B,R){let best=1e18,bx=0,by=0;
 for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){let s=0,n=0;
  for(let y=R;y<A.gh-R;y+=2)for(let x=R;x<A.gw-R;x+=2){s+=Math.abs(A.g[y*A.gw+x]-B.g[(y+dy)*B.gw+x+dx]);n++}
  s/=n;if(s<best){best=s;bx=dx;by=dy}}
 return[bx,by,best]}
function refine(refP,P,d,w,h,px,py,dx,dy,ds){let best=1e18,rx=dx,ry=dy;
 for(let jy=-ds;jy<=ds;jy++)for(let jx=-ds;jx<=ds;jx++){const ox=dx+jx,oy=dy+jy;if(px+ox<0||py+oy<0||px+ox+P>w||py+oy+P>h)continue;let s=0;
  for(let y=0;y<P;y+=3){const rr=y*P,cc=((py+oy+y)*w+px+ox)<<2;for(let x=0;x<P;x+=3){const p=cc+(x<<2);s+=Math.abs(refP[rr+x]-((77*d[p]+151*d[p+1]+28*d[p+2])>>8))}}
  if(s<best){best=s;rx=ox;ry=oy}}
 const m=Math.ceil(P/3);return[rx,ry,best/(m*m)]}
function accum(acc,d0,d,w,h,dx,dy,thr){
 for(let y=0;y<h;y++){let sy=y+dy;sy=sy<0?0:sy>=h?h-1:sy;const ro=y*w,co=sy*w;
  for(let x=0;x<w;x++){let sx2=x+dx;sx2=sx2<0?0:sx2>=w?w-1:sx2;const pr=(ro+x)<<2,pc=(co+sx2)<<2,a=(ro+x)*3;
   for(let c=0;c<3;c++){const r=d0[pr+c],v=d[pc+c];acc[a+c]+=(v-r>thr||r-v>thr)?r:v}}}}
function boxBlur(src,w,h,r){const tmp=new Uint8ClampedArray(src.length),out=new Uint8ClampedArray(src.length),k=2*r+1;
 for(let y=0;y<h;y++){const o=y*w;let s=0;for(let i=-r;i<=r;i++)s+=src[o+Math.min(w-1,Math.max(0,i))];
  for(let x=0;x<w;x++){tmp[o+x]=s/k;const a=x+r+1,b=x-r;s+=src[o+(a>=w?w-1:a)]-src[o+(b<0?0:b)]}}
 for(let x=0;x<w;x++){let s=0;for(let i=-r;i<=r;i++)s+=tmp[Math.min(h-1,Math.max(0,i))*w+x];
  for(let y=0;y<h;y++){out[y*w+x]=s/k;const a=y+r+1,b=y-r;s+=tmp[(a>=h?h-1:a)*w+x]-tmp[(b<0?0:b)*w+x]}}
 return out}
function sigma(Y,w,h,T,st){const out=Y.slice();
 for(let y=st;y<h-st;y++){let i=y*w+st;for(let x=st;x<w-st;x++,i++){const c=Y[i];let s=c,n=1,v;
  v=Y[i-st*w-st];if(v-c<=T&&c-v<=T){s+=v;n++}v=Y[i-st*w];if(v-c<=T&&c-v<=T){s+=v;n++}v=Y[i-st*w+st];if(v-c<=T&&c-v<=T){s+=v;n++}
  v=Y[i-st];if(v-c<=T&&c-v<=T){s+=v;n++}v=Y[i+st];if(v-c<=T&&c-v<=T){s+=v;n++}
  v=Y[i+st*w-st];if(v-c<=T&&c-v<=T){s+=v;n++}v=Y[i+st*w];if(v-c<=T&&c-v<=T){s+=v;n++}v=Y[i+st*w+st];if(v-c<=T&&c-v<=T){s+=v;n++}
  out[i]=s/n}}
 return out}
/*PURE-END*/
async function cleanup(img,w,h,o){const d=img.data,n=w*h;let Y=new Uint8ClampedArray(n),U=new Uint8ClampedArray(n),Vv=new Uint8ClampedArray(n);
 for(let i=0,p=0;i<n;i++,p+=4){const r=d[p],g=d[p+1],b=d[p+2];Y[i]=.299*r+.587*g+.114*b;U[i]=128-.168736*r-.331264*g+.5*b;Vv[i]=128+.5*r-.418688*g-.081312*b}
 note(o.label+': giảm nhiễu màu…');await tick();U=boxBlur(U,w,h,o.rc);Vv=boxBlur(Vv,w,h,o.rc);
 note(o.label+': giảm nhiễu sáng…');await tick();Y=sigma(Y,w,h,o.T1,o.s1);if(o.T2){await tick();Y=sigma(Y,w,h,o.T2,o.s2)}
 let lut=null;if(o.tone){let m=0,c=0;for(let i=0;i<n;i+=13){m+=Y[i];c++}m=Math.max(8,m/c)/255;const g=clamp(Math.log(.42)/Math.log(m),.5,1);lut=new Uint8ClampedArray(256).map((_,i)=>255*Math.pow(i/255,g))}
 const cs=o.cs||1;
 for(let i=0,p=0;i<n;i++,p+=4){const y=lut?lut[Y[i]]:Y[i],u=(U[i]-128)*cs,v=(Vv[i]-128)*cs;d[p]=y+1.402*v;d[p+1]=y-.344136*u-.714136*v;d[p+2]=y+1.772*u}}
async function stackShot(s,cr,k,o){const w=Math.round(cr[2]*k),h=Math.round(cr[3]*k),n=w*h,c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true}),acc=new Uint16Array(n*3);
 const ds=Math.max(4,Math.round(w/256)),P=Math.min(384,w>>1,h>>1),px=(w-P)>>1,py=(h-P)>>1;let d0=null,g0=null,refP=null,used=0;
 for(let i=0;i<o.N;i++){note(`${o.label} ${i+1}/${o.N} – giữ yên máy…`);if(i){await nextFrame(s);if(o.skip)await nextFrame(s)}
  x.drawImage(s,...cr,0,0,w,h);const d=x.getImageData(0,0,w,h).data;
  if(!d0){d0=d;g0=lumaGrid(d0,w,h,ds);refP=new Uint8Array(P*P);for(let y=0;y<P;y++)for(let xx=0;xx<P;xx++){const p=((py+y)*w+px+xx)<<2;refP[y*P+xx]=(77*d0[p]+151*d0[p+1]+28*d0[p+2])>>8}
   for(let j=0;j<n;j++){acc[j*3]=d0[j<<2];acc[j*3+1]=d0[(j<<2)+1];acc[j*3+2]=d0[(j<<2)+2]}used=1;continue}
  const[bx,by]=align1(g0,lumaGrid(d,w,h,ds),10),[rx,ry,mad]=refine(refP,P,d,w,h,px,py,bx*ds,by*ds,ds);
  if(mad<=o.maxMad){accum(acc,d0,d,w,h,rx,ry,o.thr);used++}await tick()}
 const out=x.createImageData(w,h),od=out.data;for(let j=0;j<n;j++){const a=j*3,p=j<<2;od[p]=acc[a]/used;od[p+1]=acc[a+1]/used;od[p+2]=acc[a+2]/used;od[p+3]=255}
 d0=null;await cleanup(out,w,h,o);x.putImageData(out,0,0);return{c,used}}

/* ---------- Chụp ---------- */
let busy=false;const tick=()=>new Promise(r=>setTimeout(r,0));
const nextFrame=s=>Promise.race([new Promise(r=>s.requestVideoFrameCallback?s.requestVideoFrameCallback(()=>r()):setTimeout(r,70)),new Promise(r=>setTimeout(r,250))]);
function meanLuma(s){sx.drawImage(s,0,0,96,128);const d=sx.getImageData(0,0,96,128).data;let m=0;for(let i=0;i<d.length;i+=4)m+=.3*d[i]+.59*d[i+1]+.11*d[i+2];return m/(d.length/4)}
const hiOK=()=>!!(ic&&photoCaps&&photoCaps.imageWidth&&photoCaps.imageWidth.max>(track.getSettings().width||0)*1.15);
async function hiResShot(cr,R){const pc=photoCaps,Wv=vid.videoWidth,Hv=vid.videoHeight;
 const targetW=R.cap,targetH=Math.round(R.cap*Hv/Wv);
 const iw=clamp(targetW,pc.imageWidth.min,pc.imageWidth.max),ih=clamp(targetH,pc.imageHeight.min,pc.imageHeight.max);
 const blob=await ic.takePhoto({imageWidth:iw,imageHeight:ih}),im=await createImageBitmap(blob,{imageOrientation:'from-image'});
 if(Math.abs(im.width/im.height-Wv/Hv)>.03)throw Error('lệch tỉ lệ');
 const f=im.width/Wv,sw=cr[2]*f,sh=cr[3]*f,k=Math.min(1,R.cap/Math.max(sw,sh)),w=Math.round(sw*k),h=Math.round(sh*k),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(im,cr[0]*f,cr[1]*f,sw,sh,0,0,w,h);return c}
function adjust(c){const b=hardwareEV?1:Math.pow(2,P.ev),ct=1+P.ct/100;if(Math.abs(b-1)<.01&&Math.abs(ct-1)<.01)return c;const c2=document.createElement('canvas');c2.width=c.width;c2.height=c.height;const x=c2.getContext('2d');x.filter=`brightness(${b}) contrast(${ct})`;x.drawImage(c,0,0);return c2}
$('shut').onclick=async()=>{if(busy)return;const delay=+$('captureTimer').value;if(delay>0){$('shut').disabled=true;for(let n=delay;n>0;n--){note('Chụp sau '+n+' giây…');await new Promise(r=>setTimeout(r,1000))}$('shut').disabled=false}busy=true;$('shut').style.opacity=.5;
 try{const s=src(),R=RES[resK],cr=crop(s),L=Math.max(cr[2],cr[3]);let k=Math.min(1,R.cap/L),cv,info='';
  if(mode==='night'&&stream){k=Math.min(k,Math.sqrt(12.7e6/(cr[2]*cr[3])));const N=cr[2]*cr[3]*k*k>9e6?6:8,r=await stackShot(s,cr,k,{N,label:'Chụp đêm',skip:1,maxMad:35,thr:50,rc:4,T1:18,s1:2,T2:10,s2:1,tone:1,cs:1.12});cv=r.c;info=`xếp chồng ${r.used}/${N} khung`}
  else{if(stream&&hiOK()&&R.cap>2200){try{cv=await hiResShot(cr,R);info='ảnh tĩnh gốc cảm biến'}catch(_){cv=null}}
   if(!cv){if(stream&&meanLuma(s)<80){k=Math.min(k,Math.sqrt(12.7e6/(cr[2]*cr[3])));const r=await stackShot(s,cr,k,{N:3,label:'Thiếu sáng',maxMad:30,thr:44,rc:2,T1:8,s1:1});cv=r.c;info=`cảnh tối: gộp ${r.used}/3 khung`}
    else{const w=Math.round(cr[2]*k),h=Math.round(cr[3]*k);cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(s,...cr,0,0,w,h)}}
   cv=adjust(cv)}
  if(activeLook!=='natural'){const fx=document.createElement('canvas');fx.width=cv.width;fx.height=cv.height;const fxctx=fx.getContext('2d');fxctx.filter=lookFilters[activeLook]||'none';fxctx.drawImage(cv,0,0);cv=fx}
  cv=decorateCapture(cv);
  note('Đang lưu ảnh chất lượng cao…');await tick();const b=await blobOf(cv,+$('captureQuality').value),id=Date.now(),w=cv.width,h=cv.height;
  await dbPut({id,t:id,orig:b,cur:b,thumb:await thumbOf(b),p:null,src:'camera',mode,look:activeLook,quality:+$('captureQuality').value,frame:$('captureFrame').value,scene:aiOn?(SC_VN[scn.k]||''):''});autoTag(id);$('thumb').style.backgroundImage=`url(${URL.createObjectURL(b)})`;
  note(`Đã lưu ${w}×${h} (${(w*h/1e6).toFixed(1)}MP)${info?' · '+info:''}`);$('vf').style.opacity=.4;setTimeout(()=>$('vf').style.opacity=1,100);if(navigator.vibrate)navigator.vibrate(20)}
 catch(e){note('Lỗi chụp: '+e.message)}finally{busy=false;$('shut').style.opacity=1}};
$('thumb').onclick=()=>go('gal');

/* ---------- THƯ VIỆN ---------- */
let viewerPhotoId=null,viewerUrl=null,galFilter='all',galSelectMode=false,galSelected=new Set(),galVisible=[];
function releaseViewerUrl(){if(viewerUrl){URL.revokeObjectURL(viewerUrl);viewerUrl=null}}
async function showPhotoPreview(id){
 const photo=await dbGet(id);if(!photo)return;viewerPhotoId=id;releaseViewerUrl();
 const blob=photo.cur||photo.orig;viewerUrl=URL.createObjectURL(blob);$('vImg').src=viewerUrl;
 $('vInfo').textContent=`${photo.p?'Đã chỉnh sửa':'Ảnh gốc'} · ${new Date(photo.t).toLocaleString('vi-VN')}`;
 $('vFav').textContent=photo.favorite?'♥ Đã thích':'♡ Yêu thích';$('imgViewer').classList.add('on');$('imgViewer').setAttribute('aria-hidden','false');
}
function closePhotoPreview(){$('imgViewer').classList.remove('on');$('imgViewer').setAttribute('aria-hidden','true');$('vImg').removeAttribute('src');releaseViewerUrl();viewerPhotoId=null}
async function stepViewer(d){const i=galVisible.findIndex(p=>p.id===viewerPhotoId),n=i+d;if(n>=0&&n<galVisible.length)await showPhotoPreview(galVisible[n].id)}
$('galBody').onclick=e=>{const tile=e.target.closest('[data-id]');if(!tile)return;const id=+tile.dataset.id;if(galSelectMode){galSelected.has(id)?galSelected.delete(id):galSelected.add(id);updateSelectionUI();loadGal();return}showPhotoPreview(id)};
$('vClose').onclick=closePhotoPreview;$('imgViewer').onclick=e=>{if(e.target===$('imgViewer'))closePhotoPreview()};
$('vPrev').onclick=()=>stepViewer(-1);$('vNext').onclick=()=>stepViewer(1);
$('vFav').onclick=async()=>{if(viewerPhotoId===null)return;const p=await dbGet(viewerPhotoId);p.favorite=!p.favorite;await dbPut(p);$('vFav').textContent=p.favorite?'♥ Đã thích':'♡ Yêu thích';loadGal()};
$('vEdit').onclick=()=>{if(viewerPhotoId!==null){const id=viewerPhotoId;closePhotoPreview();openStudio(id)}};
document.addEventListener('keydown',e=>{if(!$('imgViewer').classList.contains('on'))return;if(e.key==='Escape')closePhotoPreview();if(e.key==='ArrowLeft')stepViewer(-1);if(e.key==='ArrowRight')stepViewer(1)});
$('bImp').onclick=()=>$('fImp').click();
// Sửa lỗi id trùng: dùng Date.now() + bộ đếm
let impSeq=0;
$('fImp').onchange=async e=>{const files=[...e.target.files];for(const f of files){const id=Date.now()*1000+(impSeq++%1000);await dbPut({id,t:f.lastModified||Date.now(),orig:f,cur:f,thumb:await thumbOf(f),p:null,src:'import',favorite:false,tags:[]})}e.target.value='';loadGal()};
$('bExp').onclick=async()=>{for(const p of await dbAll()){const a=document.createElement('a'),u=URL.createObjectURL(p.cur||p.orig);a.href=u;a.download='aps-'+p.id+'.jpg';a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);await new Promise(r=>setTimeout(r,250))}};
function updateSelectionUI(){$('galSelection').hidden=!galSelectMode;$('galFilters').hidden=galSelectMode;$('selCount').textContent=galSelected.size+' đã chọn';$('bSelect').textContent=galSelectMode?'Đang chọn':'Chọn'}
$('bSelect').onclick=()=>{galSelectMode=!galSelectMode;if(!galSelectMode)galSelected.clear();updateSelectionUI();loadGal()};
$('selCancel').onclick=()=>{galSelectMode=false;galSelected.clear();updateSelectionUI();loadGal()};
$('selFav').onclick=async()=>{for(const id of galSelected){const p=await dbGet(id);if(p){p.favorite=true;await dbPut(p)}}galSelected.clear();galSelectMode=false;updateSelectionUI();loadGal()};
$('selDelete').onclick=async()=>{if(!galSelected.size)return;if(!confirm(`Xóa ${galSelected.size} ảnh đã chọn khỏi thư viện?`))return;await dbp;const t=db.transaction('p','readwrite'),st=t.objectStore('p');galSelected.forEach(id=>st.delete(id));t.oncomplete=()=>{galSelected.clear();galSelectMode=false;updateSelectionUI();loadGal()}};
$('galFilters').onclick=e=>{const b=e.target.closest('[data-filter]');if(!b)return;galFilter=b.dataset.filter;document.querySelectorAll('#galFilters [data-filter]').forEach(x=>x.classList.toggle('on',x===b));loadGal()};
let galTag='';
async function loadGal(){const all=(await dbAll()).sort((x,y)=>y.t-x.t),g=$('galBody'),cnt={};
 all.forEach(p=>(p.tags||[]).forEach(t=>cnt[t]=(cnt[t]||0)+1));const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,14);
 $('gTags').innerHTML=top.map(([t,n])=>`<button class="chip${galTag===t?' on':''}" data-t="${esc(t)}">#${esc(t)} <small>${n}</small></button>`).join('');$('gTags').style.display=top.length?'flex':'none';
 if(!all.length){galVisible=[];g.innerHTML='<div class="empty">Chưa có ảnh. Chụp, nhập từ máy hoặc tạo ảnh AI.</div>';return}
 const qy=$('gQ').value.trim().toLowerCase();galVisible=all.filter(p=>(!galTag||(p.tags||[]).includes(galTag))&&(!qy||[(p.tags||[]).join(' '),p.scene||'',p.desc||'',p.aiPrompt||''].join(' ').toLowerCase().includes(qy))&&(galFilter!=='fav'||p.favorite)&&(galFilter!=='ai'||p.ai||p.src==='gemini'));
 if(!galVisible.length){g.innerHTML='<div class="empty">Không có ảnh khớp bộ lọc.</div>';return}
 const days={};galVisible.forEach(p=>(days[new Date(p.t).toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'numeric'})]??=[]).push(p));
 g.innerHTML=Object.entries(days).map(([d,l])=>`<div class="day">${d}</div><div class="grid">${l.map(p=>`<div data-id="${p.id}" class="${galSelected.has(p.id)?'selected':''}" style="background-image:url(${p.thumb})">${galSelectMode&&galSelected.has(p.id)?'<i class="selmark">✓</i>':''}${p.favorite?'<span>♥</span>':''}${p.ai||p.src==='gemini'?'<span class="ai">✦ AI</span>':''}${p.p?'<span>✎</span>':''}</div>`).join('')}</div>`).join('')}
$('gQ').oninput=()=>loadGal();$('gTags').onclick=e=>{const t=e.target.closest('[data-t]');if(!t)return;galTag=galTag===t.dataset.t?'':t.dataset.t;loadGal()};
$('bGenNew').onclick=()=>go('ai');

/* ---------- STUDIO: chỉnh sửa không phá huỷ ---------- */
const SL=[['ex','Phơi sáng',-3,3,.05,0,'L'],['ct','Tương phản',-100,100,1,0,'L'],['hl','Vùng sáng',-100,100,1,0,'L'],['sh','Vùng tối',-100,100,1,0,'L'],['tp','Nhiệt độ',-100,100,1,0,'C'],['sa','Bão hoà',-100,100,1,0,'C'],['vg','Viền tối',0,100,1,0,'C'],['nr','Giảm nhiễu',0,100,1,0,'D'],['sp','Độ sắc nét',0,100,1,0,'D'],['cl','Độ rõ nét',-100,100,1,0,'D']];
let cur=null,E={},base=null,orig2=null;
SL.forEach(s=>$('sl'+s[6]).insertAdjacentHTML('beforeend',`<div class="sl"><span>${s[1]}</span><input type="range" id="e_${s[0]}" min="${s[2]}" max="${s[3]}" step="${s[4]}" value="${s[5]}"><output id="o_${s[0]}">0</output></div>`));
SL.forEach(s=>{const row=$('e_'+s[0]).closest('.sl');row.classList.remove('open');row.querySelector('span').style.cursor='pointer';row.querySelector('span').onclick=()=>{document.querySelectorAll('.pnl .sl').forEach(x=>x.classList.toggle('open',x===row))};});
SL.forEach(s=>$('e_'+s[0]).oninput=()=>{E[s[0]]=+$('e_'+s[0]).value;$('o_'+s[0]).textContent=E[s[0]];queue()});
const zero=()=>Object.fromEntries(SL.map(s=>[s[0],0]));
function setE(o){E={...zero(),...o};SL.forEach(s=>{$('e_'+s[0]).value=E[s[0]];$('o_'+s[0]).textContent=E[s[0]]})}
function proc(src,dst,e,vgOn=true){const s=src.data,d=dst.data,w=src.width,h=src.height,ex=Math.pow(2,e.ex),c=1+e.ct/100,sa=1+e.sa/100,t=e.tp/100*30,hl=e.hl/100*.6,sh=e.sh/100*.6,vg=e.vg/100;
 for(let i=0,p=0;i<s.length;i+=4,p++){let r=s[i]*ex+t,g=s[i+1]*ex,b=s[i+2]*ex-t;const y=.3*r+.59*g+.11*b,n=y/255;
  const dl=n>.5?-hl*(n-.5)*2*255*.5:sh*(.5-n)*2*255*.5;r+=dl;g+=dl;b+=dl;
  r=(r-128)*c+128;g=(g-128)*c+128;b=(b-128)*c+128;const l=.3*r+.59*g+.11*b;r=l+(r-l)*sa;g=l+(g-l)*sa;b=l+(b-l)*sa;
  if(vg&&vgOn){const x=(p%w)/w-.5,yy=((p/w)|0)/h-.5,f=1-vg*Math.min(1,(x*x+yy*yy)*2.2);r*=f;g*=f;b*=f}
  d[i]=r;d[i+1]=g;d[i+2]=b;d[i+3]=255}}
let q=0;const queue=()=>{if(!q)q=requestAnimationFrame(()=>{q=0;render()})};
function render(){if(!base)return;const c=$('cvA'),x=c.getContext('2d'),o=x.createImageData(base.width,base.height);proc(base,o,E);postFx(o,E,1);x.putImageData(o,0,0)}
let cmp=false;$('sCmp').onclick=()=>{cmp=!cmp;$('cvO').style.display=cmp?'block':'none';$('tagB').style.display=cmp?'block':'none';$('cmpR').style.display=cmp?'block':'none';$('cvO').style.clipPath=`inset(0 ${100-$('cmpR').value}% 0 0)`};
$('cmpR').oninput=e=>{$('cvO').style.clipPath=`inset(0 ${100-e.target.value}% 0 0)`;$('tagB').style.left='8px'};
$('sDl').onclick=async()=>{if(!cur)return;const a=document.createElement('a');a.href=URL.createObjectURL(await fullRender());a.download='aps-edit-'+cur.id+'.jpg';a.click()};

/* Lịch sử hoàn tác/làm lại */
let HIST=[],hp=-1,srcBmp=null,cropR=null,preN='';
const snap=()=>JSON.stringify({E,cr:cropR});
function updUR(){$('sUndo').disabled=hp<=0;$('sRedo').disabled=hp>=HIST.length-1}
function pushH(){if(!cur)return;const s=snap();if(HIST[hp]===s)return;HIST=HIST.slice(0,hp+1);HIST.push(s);if(HIST.length>60)HIST.shift();hp=HIST.length-1;updUR()}
async function goH(i){if(i<0||i>=HIST.length)return;hp=i;const o=JSON.parse(HIST[i]),same=JSON.stringify(o.cr)===JSON.stringify(cropR);setE(o.E);cropR=o.cr;if(!same)await buildBase();render();updUR()}
$('sUndo').onclick=()=>goH(hp-1);$('sRedo').onclick=()=>goH(hp+1);
SL.forEach(s=>$('e_'+s[0]).addEventListener('change',()=>pushH()));

async function buildBase(){const sw=srcBmp.width,sh=srcBmp.height,r=cropR||[0,0,1,1],x0=r[0]*sw,y0=r[1]*sh,cw=r[2]*sw,ch=r[3]*sh,k=Math.min(1,1400/Math.max(cw,ch)),w=Math.max(1,cw*k|0),h=Math.max(1,ch*k|0);
 for(const c of [$('cvA'),$('cvO')]){c.width=w;c.height=h}$('cvO').getContext('2d').drawImage(srcBmp,x0,y0,cw,ch,0,0,w,h);const a=$('cvA').getContext('2d');a.drawImage(srcBmp,x0,y0,cw,ch,0,0,w,h);base=a.getImageData(0,0,w,h)}
async function openStudio(id){cur=await dbGet(id);if(!cur)return;cmp=false;$('cvO').style.display='none';$('tagB').style.display='none';$('cmpR').style.display='none';
 srcBmp=await bmp(cur.orig);const{cr,...pe}=cur.p||{};cropR=cr||null;await buildBase();
 $('stEmpty').style.display='none';$('stk').style.display='block';setE(pe);preN='';document.querySelectorAll('#presets .chip').forEach(b=>b.classList.remove('on'));
 HIST=[];hp=-1;pushH();$('aiOut').style.display='none';if(cur.ana)renderAna(cur.ana);go('stu');render()}
function postFx(img,e,sc=1){const nr=e.nr||0,sp=e.sp||0,cl=e.cl||0;if(!(nr||sp||cl))return;const w=img.width,h=img.height,d=img.data,n=w*h;
 let Y=new Uint8ClampedArray(n);for(let i=0,p=0;i<n;i++,p+=4)Y[i]=.299*d[p]+.587*d[p+1]+.114*d[p+2];
 const Y0=Y;let U,Vv;
 if(nr){U=new Uint8ClampedArray(n);Vv=new Uint8ClampedArray(n);for(let i=0,p=0;i<n;i++,p+=4){const r=d[p],g=d[p+1],b=d[p+2];U[i]=128-.168736*r-.331264*g+.5*b;Vv[i]=128+.5*r-.418688*g-.081312*b}
  const rc=Math.max(1,Math.round((1+nr/30)*sc));U=boxBlur(U,w,h,rc);Vv=boxBlur(Vv,w,h,rc);Y=sigma(Y,w,h,4+nr*.2,sc>1.5?2:1)}
 if(sp){const b=boxBlur(Y,w,h,Math.max(1,Math.round(sc))),a=sp/100*1.3,o=new Uint8ClampedArray(n);for(let i=0;i<n;i++)o[i]=Y[i]+a*(Y[i]-b[i]);Y=o}
 if(cl){const b=boxBlur(Y,w,h,Math.max(8,Math.round(14*sc))),a=cl/100*.9,o=new Uint8ClampedArray(n);for(let i=0;i<n;i++){const t=Y[i]/255,wg=1-Math.abs(t*2-1)*.6;o[i]=Y[i]+a*wg*(Y[i]-b[i])}Y=o}
 if(nr){for(let i=0,p=0;i<n;i++,p+=4){const y=Y[i],u=U[i]-128,v=Vv[i]-128;d[p]=y+1.402*v;d[p+1]=y-.344136*u-.714136*v;d[p+2]=y+1.772*u}}
 else for(let i=0,p=0;i<n;i++,p+=4){const dy=Y[i]-Y0[i];d[p]+=dy;d[p+1]+=dy;d[p+2]+=dy}}
async function fullRender(){const im=srcBmp,r=cropR||[0,0,1,1],x0=Math.round(r[0]*im.width),y0=Math.round(r[1]*im.height),cw=Math.max(1,Math.round(r[2]*im.width)),ch=Math.max(1,Math.round(r[3]*im.height)),c=document.createElement('canvas');c.width=cw;c.height=ch;const x=c.getContext('2d');x.drawImage(im,x0,y0,cw,ch,0,0,cw,ch);
 const s=x.getImageData(0,0,cw,ch),o=x.createImageData(cw,ch);proc(s,o,E);postFx(o,E,Math.max(1,Math.round(cw/1400)));x.putImageData(o,0,0);return blobOf(c)}
$('sSave').onclick=async()=>{if(!cur)return;$('gMsg').textContent='Đang xuất ảnh đầy đủ độ phân giải…';const b=await fullRender();cur.cur=b;cur.p={...E,cr:cropR};cur.thumb=await thumbOf(b);await dbPut(cur);$('gMsg').textContent='Đã lưu – ảnh gốc vẫn được giữ nguyên, bấm ↺ Gốc để quay lại.'};
$('sRst').onclick=async()=>{if(!cur)return;setE({});preN='';document.querySelectorAll('#presets .chip').forEach(b=>b.classList.remove('on'));if(cropR){cropR=null;await buildBase()}render();pushH()};

/* ---------- KHỞI ĐỘNG ---------- */
initAI();   // gắn sự kiện cho phần AI (định nghĩa trong ai-engine.js)
startCam();

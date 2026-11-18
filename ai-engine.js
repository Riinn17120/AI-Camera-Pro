
/* =====================================================================
   ai-engine.js — Bộ xử lý AI
   Nạp TRƯỚC app.js. File này chỉ KHAI BÁO; mọi thao tác gắn vào DOM nằm trong
   initAI(), được app.js gọi sau khi mọi thứ đã sẵn sàng.
   ===================================================================== */

/* ============ 1) CẤU HÌNH GEMINI API KEY TẠM THỜI ============ */
// CHỈ DÙNG TEST CỤC BỘ. KHÔNG ĐƯA FILE NÀY LÊN WEBSITE/GITHUB CÔNG KHAI.
const GEMINI_API_KEY = 'AQ.Ab8RN6JNHszM-6ILXPjmcCOJEElawXO0dZvBWB9fgJ0EsAiEUQ';
const aiBackendReady = () =>
  typeof GEMINI_API_KEY === 'string' &&
  GEMINI_API_KEY.length > 20 &&
  !GEMINI_API_KEY.includes('DAN_API_KEY');

/* ============ 2) TIỆN ÍCH ============ */
const ls=(k,d='')=>{try{return localStorage.getItem(k)??d}catch(_){return d}},lset=(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}};
const ss=(k,d='')=>{try{return sessionStorage.getItem(k)??d}catch(_){return d}},sset=(k,v)=>{try{v===null?sessionStorage.removeItem(k):sessionStorage.setItem(k,v)}catch(_){}};
const b64=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(b)});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyOk=()=>aiBackendReady();
function stat(m){$('gStat').textContent=m||(keyOk()?($('gOk').checked?'Gemini API đã sẵn sàng. Ảnh chỉ gửi đi khi bạn chủ động dùng AI và đã đồng ý.':'Hãy tích đồng ý gửi ảnh để dùng tính năng AI.'):'Chưa nhập Gemini API Key.')}
const aiLogs=[];function aiLog(t){aiLogs.unshift(new Date().toLocaleTimeString('vi-VN')+' · '+t);aiLogs.length=Math.min(aiLogs.length,10);$('aiLog').innerHTML=aiLogs.map(esc).join('<br>')}

/* ============ 3) KẾT NỐI GEMINI TRỰC TIẾP (TẠM THỜI) ============ */
let aiCtl=null;
function aiNeed(){
  if(!keyOk()){go('ai');throw Error('Bạn chưa nhập Gemini API Key.');}
  if(!$('gOk').checked){go('ai');throw Error('Hãy đồng ý gửi ảnh tới Google Gemini trong tab AI trước khi dùng tính năng này.');}
}
async function gem(model,parts,cfg,o={}){
  aiNeed();
  const body=JSON.stringify({contents:[{parts}],...(cfg?{generationConfig:cfg}:{})});
  for(let a=0;a<2;a++){
    const ctl=aiCtl=new AbortController(),to=setTimeout(()=>ctl.abort('timeout'),o.timeout||90000);
    let r,j;
    try{
      r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY},
        body,signal:ctl.signal
      });
      j=await r.json().catch(()=>({}));
    }catch(e){
      clearTimeout(to);
      if(ctl.signal.aborted)throw Error(ctl.signal.reason==='timeout'?'Hết thời gian chờ Gemini.':'Đã dừng.');
      throw Error('Không kết nối được tới Google Gemini. Hãy kiểm tra mạng.');
    }
    clearTimeout(to);
    if(r.ok){
      const br=j.promptFeedback&&j.promptFeedback.blockReason;
      if(br)throw Error('Yêu cầu bị bộ lọc an toàn chặn ('+br+'). Hãy đổi mô tả.');
      return j;
    }
    if((r.status===503||r.status===429)&&a===0){await new Promise(x=>setTimeout(x,1800));continue;}
    const m=j.error&&j.error.message||'';
    throw Error(r.status===400?'Yêu cầu không hợp lệ: '+m:r.status===401||r.status===403?'API Key không hợp lệ hoặc không có quyền truy cập: '+m:r.status===404?'Không tìm thấy model "'+model+'" – hãy kiểm tra tên model.':r.status===429?'Bạn đã đạt giới hạn sử dụng Gemini. Hãy thử lại sau.':r.status===503?'Gemini đang quá tải.':'Lỗi '+r.status+(m?': '+m:''));
  }
}
async function shrink(blob,max=1536,q=.88){const im=await bmp(blob),k=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(im.src);return blobOf(c,q)}
const imgPart=async(b,max)=>({inline_data:{mime_type:'image/jpeg',data:await b64(await shrink(b,max))}});
function jparse(t){t=String(t||'').replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();try{return JSON.parse(t)}catch(_){const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a)try{return JSON.parse(t.slice(a,b+1))}catch(_){}throw Error('AI trả về dữ liệu không đúng định dạng.')}}
const txtOf=j=>{const p=j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts||[];return p.filter(x=>x.text).map(x=>x.text).join('\n').trim()};
function imgOf(j){const c=j.candidates&&j.candidates[0],ps=c&&c.content&&c.content.parts||[],p=ps.find(x=>x.inlineData||x.inline_data);
 if(!p){const t=txtOf(j);throw Error(t?'Mô hình không tạo ảnh: '+t.slice(0,200):'Mô hình không trả về ảnh'+(c&&c.finishReason?' ('+c.finishReason+')':'.'))}
 const q=p.inlineData||p.inline_data,bin=atob(q.data),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return{blob:new Blob([u],{type:q.mimeType||q.mime_type||'image/png'}),text:txtOf(j)}}
function cleanE(o){const r={};SL.forEach(s=>{if(o&&o[s[0]]!=null&&isFinite(+o[s[0]]))r[s[0]]=clamp(+o[s[0]],s[2],s[3])});return r}
async function aiRun(label,fn,msg=$('gMsg'),cancel=$('gCancel')){msg.textContent=label+'…';if(cancel)cancel.style.display='inline-block';
 try{return await fn()}catch(e){msg.textContent='Lỗi: '+e.message;aiLog('Lỗi: '+e.message)}finally{if(cancel)cancel.style.display='none'}}

/* ============ 4) PHÂN TÍCH ẢNH (Gemini) ============ */
const ANA_PROMPT=`Bạn là chuyên gia nhiếp ảnh. Phân tích ảnh và CHỈ trả về JSON (không thêm văn bản khác) theo mẫu:
{"scene":"một trong: chân dung|nhóm|phong cảnh|hoàng hôn|thiếu sáng|đồ ăn|thú cưng|kiến trúc|tài liệu|đường phố|macro|khác","tags":["tối đa 8 thẻ ngắn tiếng Việt, không có dấu #"],"description":"mô tả 1 câu tiếng Việt","quality":{"exposure":"thiếu|ổn|thừa","noise":"thấp|vừa|cao","sharpness":"mờ|ổn|nét"},"tip":"1 lời khuyên chỉnh sửa ngắn tiếng Việt","edit":{"ex":0,"ct":0,"hl":0,"sh":0,"tp":0,"sa":0,"vg":0,"nr":0,"sp":0,"cl":0}}
Khoảng giá trị edit: ex -3..3; ct,hl,sh,tp,sa,cl -100..100; vg,nr,sp 0..100. Đề xuất chỉnh nhẹ, tự nhiên.`;
async function analyzePhoto(id){const rec=await dbGet(id);if(!rec)throw Error('Không tìm thấy ảnh.');
 const j=await gem($('mTxt').value||'gemini-2.5-flash',[await imgPart(rec.cur||rec.orig,1024),{text:ANA_PROMPT}],{responseMimeType:'application/json',temperature:.2});
 const r=jparse(txtOf(j));
 const tags=[...new Set((Array.isArray(r.tags)?r.tags:[]).map(x=>String(x).replace(/^#/,'').trim().toLowerCase().slice(0,24)).filter(Boolean))].slice(0,8);
 const a={scene:String(r.scene||'').toLowerCase().slice(0,24),tags,desc:String(r.description||'').slice(0,200),quality:r.quality&&typeof r.quality==='object'?r.quality:{},tip:String(r.tip||'').slice(0,200),edit:cleanE(r.edit)};
 const fresh=await dbGet(id);if(fresh){fresh.scene=a.scene||fresh.scene||'';fresh.tags=tags.length?tags:['ảnh'];fresh.desc=a.desc;fresh.ana=a;await dbPut(fresh);if(cur&&cur.id===id){cur.scene=fresh.scene;cur.ana=a}}
 aiLog('Phân tích ảnh: '+(a.scene||'?')+' · '+tags.join(', '));return a}
function renderAna(a){const o=$('aiOut');o.style.display='block';
 o.innerHTML=`<b>${esc(a.scene||'ảnh')}</b> · ${esc(a.desc)}<br><span class="note">Phơi sáng: ${esc(a.quality.exposure||'?')} · Nhiễu: ${esc(a.quality.noise||'?')} · Độ nét: ${esc(a.quality.sharpness||'?')}</span><div class="tags">${a.tags.map(t=>`<span>#${esc(t)}</span>`).join('')}</div>${a.tip?`<div class="note">${esc(a.tip)}</div>`:''}${Object.keys(a.edit).length?'<button class="btn" id="anaApply">Áp dụng gợi ý chỉnh</button>':''}`;
 const b=$('anaApply');if(b)b.onclick=()=>{setE({...E,...a.edit});render();pushH();$('gMsg').textContent='Đã áp dụng gợi ý từ phân tích (↶ để hoàn tác).'}}
function autoTag(id){if(!$('tAuto').checked||!keyOk()||!$('gOk').checked)return;analyzePhoto(id).catch(e=>aiLog('Tự gắn thẻ lỗi: '+e.message))}

/* ============ 5) AI CỤC BỘ TRÊN STUDIO: tự chỉnh, phong cách, cắt khung ============ */
const SC_EDIT={};const SA=(o,...ks)=>ks.forEach(k=>SC_EDIT[k]=o);
SA({sa:-6,sh:10,nr:12,cl:-10},'chân dung');SA({sh:8,nr:10},'nhóm');SA({sh:30,hl:-25,nr:15},'ngược sáng');SA({ex:.25,sh:25,nr:40,sp:10},'thiếu sáng','đêm');
SA({ct:25,sa:-70,sp:35,cl:20},'tài liệu');SA({tp:18,sa:8,hl:-10},'hoàng hôn');SA({sa:14,cl:25,sp:20},'phong cảnh');SA({sa:15,tp:8,sp:15},'đồ ăn');SA({sp:20,nr:10},'thú cưng');SA({cl:25,sp:25},'kiến trúc');SA({sp:25},'macro');SA({cl:15,sp:10},'đường phố');
function autoAdjust(){if(!base)return;const d=base.data,n=d.length/4;let m=0,v=0,hi=0,lo=0,R=0,B=0;for(let i=0;i<d.length;i+=4){const y=.3*d[i]+.59*d[i+1]+.11*d[i+2];m+=y;R+=d[i];B+=d[i+2];if(y>245)hi++;if(y<10)lo++}m/=n;for(let i=0;i<d.length;i+=4){const y=.3*d[i]+.59*d[i+1]+.11*d[i+2];v+=(y-m)**2}v=Math.sqrt(v/n);
 const o={ex:+clamp(Math.log2(118/m)*.8,-1.5,1.5).toFixed(2),ct:clamp(Math.round((58-v)*1.2),-30,40),hl:hi/n>.03?-50:-15,sh:lo/n>.05||m<100?45:20,tp:clamp(Math.round((B/R-1)*60),-25,25),sa:18,vg:12,nr:m<90?30:m<130?12:5,sp:12,cl:0};
 const sc=cur&&(cur.scene||''),adj=SC_EDIT[sc];if(adj)Object.keys(adj).forEach(k=>{const s=SL.find(x=>x[0]===k);o[k]=clamp((o[k]||0)+adj[k],s[2],s[3])});
 setE(o);render();pushH();$('gMsg').textContent=sc?`Tự chỉnh theo cảnh “${sc}”.`:'Tự chỉnh theo biểu đồ sáng.'}
const PRE={'Tự nhiên':{ex:.1,ct:8,hl:-20,sh:15,sa:8,vg:8,nr:10,sp:10},'Rực rỡ':{ex:.1,ct:18,hl:-25,sh:20,sa:35,vg:10,sp:12},'Điện ảnh':{ex:-.1,ct:25,hl:-35,sh:10,tp:-12,sa:-8,vg:30,cl:15},'Hoàng hôn ấm':{ex:.05,ct:12,hl:-30,sh:20,tp:35,sa:20,vg:15},'Chân dung mềm':{ex:.2,ct:-8,hl:-25,sh:25,tp:6,sa:-5,vg:10,nr:25,cl:-15},'Phong cảnh':{ex:.05,ct:18,hl:-30,sh:25,tp:-5,sa:28,vg:12,sp:25,cl:25},'Đêm sáng':{ex:.5,ct:10,hl:-30,sh:55,sa:15,nr:45},'Đen trắng':{ct:25,sa:-100,vg:20,cl:20}};
function applyPreset(){if(!preN||!cur)return;const k=$('pK').value/100,p=PRE[preN],o={};SL.forEach(s=>{const v=(p[s[0]]||0)*k;o[s[0]]=s[0]==='ex'?+v.toFixed(2):Math.round(v)});setE(o);render()}
async function aiCrop(){if(!srcBmp)return;const c=document.createElement('canvas'),k=Math.min(1,640/Math.max(srcBmp.width,srcBmp.height));c.width=Math.round(srcBmp.width*k);c.height=Math.round(srcBmp.height*k);const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(srcBmp,0,0,c.width,c.height);
 let cx,cy,fw=0,face=false;
 try{if(FD){const f=await FD.detect(c);if(f.length){const b=f.sort((a,b)=>b.boundingBox.width-a.boundingBox.width)[0].boundingBox;cx=(b.x+b.width/2)/c.width;cy=(b.y+b.height*.4)/c.height;fw=b.width/c.width;face=true}}}catch(_){}
 if(!face){const W=c.width,Hh=c.height,d=x.getImageData(0,0,W,Hh).data,L=new Float32Array(W*Hh);let m=0;for(let i=0,p=0;i<L.length;i++,p+=4){L[i]=.3*d[p]+.59*d[p+1]+.11*d[p+2];m+=L[i]}m/=L.length;
  let sw=0,ax=0,ay=0;for(let y=1;y<Hh-1;y+=2)for(let xx=1;xx<W-1;xx+=2){const i=y*W+xx,e=Math.abs(L[i]-L[i+1])+Math.abs(L[i]-L[i+W]),w=e*e+Math.abs(L[i]-m);sw+=w;ax+=xx*w;ay+=y*w}
  if(!sw){$('gMsg').textContent='Không tìm thấy chủ thể rõ ràng để gợi ý cắt khung.';return}cx=ax/sw/W;cy=ay/sw/Hh}
 const s=face?clamp(fw/.28,.5,.95):.8;
 if(s>.92){$('gMsg').textContent='Khung hình đã cân đối, không cần cắt.';return}
 const tx=face&&Math.abs(cx-.5)<.12?.5:(cx<.5?1/3:2/3),ty=face?.36:(cy<.5?1/3:2/3);
 cropR=[clamp(cx-tx*s,0,1-s),clamp(cy-ty*s,0,1-s),s,s];await buildBase();render();pushH();
 $('gMsg').textContent=`Đã cắt khung theo ${face?'khuôn mặt':'chủ thể ước lượng'} (↶ để hoàn tác, “Bỏ cắt” để về khung gốc).`}

/* ============ 6) GEMINI: tạo ảnh & thay đổi nội dung ============ */
const KINDS={free:['Tự do','Mô tả điều bạn muốn thay đổi',t=>t],rm:['Xoá vật thể','Mô tả vật thể hoặc người cần xoá',t=>`Remove the following from this photo and fill the area naturally and seamlessly: ${t}. Keep everything else exactly the same.`],bgc:['Làm sạch nền','Không cần mô tả (có thể ghi chú thêm)',t=>`Remove distracting people and objects from the background of this photo and reconstruct the background naturally. Keep the main subject unchanged. ${t}`],bg:['Thay nền','Mô tả nền mới, VD: bãi biển lúc hoàng hôn',t=>`Replace the background of this photo with: ${t}. Keep the main subject, pose and lighting consistent and realistic.`],sty:['Đổi phong cách','VD: tranh sơn dầu, anime, phim cổ điển',t=>`Re-render this photo in the following style while keeping the composition and subject recognizable: ${t}.`],lit:['Cải thiện ánh sáng','Không cần mô tả (có thể ghi chú thêm)',t=>`Professionally improve the lighting, color and clarity of this photo. Keep content, people and composition identical. ${t}`]};
let aiKind='free';
const kHint=()=>{$('kHint').textContent=KINDS[aiKind][1];$('gPr').placeholder=KINDS[aiKind][1]};
let resP=null,resUrl='',origUrl='',showOrig=false;
async function showResult(blob,txt,meta){resP={blob,meta};showOrig=false;if(resUrl)URL.revokeObjectURL(resUrl);if(origUrl){URL.revokeObjectURL(origUrl);origUrl=''}resUrl=URL.createObjectURL(blob);$('rImg').src=resUrl;
 const im=await bmp(blob);$('rNote').textContent=`${im.width}×${im.height}px · Ảnh do AI tạo/chỉnh sửa (sẽ gắn nhãn AI trong Thư viện)${txt?' · '+txt.slice(0,160):''}`;
 $('rCmp').style.display=meta.orig?'inline-block':'none';$('rCmp').textContent='Xem ảnh gốc';$('aiRes').classList.add('on');$('aiRes').setAttribute('aria-hidden','false')}
function closeRes(){$('aiRes').classList.remove('on');$('aiRes').setAttribute('aria-hidden','true');resP=null}
async function saveRes(){if(!resP)return null;const b=resP.blob,m=resP.meta,id=Date.now();await dbPut({id,t:id,orig:b,cur:b,thumb:await thumbOf(b),p:null,src:'gemini',ai:true,aiKind:m.kind,aiPrompt:m.prompt||'',parent:m.parent||null,tags:['ai'],scene:''});aiLog('Đã lưu ảnh AI vào Thư viện');return id}
let batchStop=false;

/* ============ 7) NHẬN DIỆN KHUNG HÌNH & CẢNH TRÊN MÁY (không gửi ảnh) ============ */
const FD='FaceDetector' in window?new FaceDetector({fastMode:true,maxDetectedFaces:4}):null;
const sm=document.createElement('canvas');sm.width=96;sm.height=128;const sx=sm.getContext('2d',{willReadFrequently:true});
let subj=null,facesN=0;const sg={p:null,q:null,hold:0,until:0,sig:''},F={on:false,z:1,tx:0,ty:0},V={z:1,tx:0,ty:0},T={z:1,tx:0,ty:0};
const cover=s=>{const W=s.videoWidth||s.width,H=s.videoHeight||s.height,r=Math.max(ov.width/W,ov.height/H);return{W,H,r,ox:(W*r-ov.width)/2,oy:(H*r-ov.height)/2}};
async function detect(){if(!ov.width)return;const s=src(),cv=cover(s);let box=null,eyes=null,kind='chủ thể';
 try{facesN=0;if(FD&&stream){const f=await FD.detect(vid);facesN=f.length;if(f.length){const b=f.sort((a,b)=>b.boundingBox.width-a.boundingBox.width)[0],bb=b.boundingBox,m=p=>({x:p.x*cv.r-cv.ox,y:p.y*cv.r-cv.oy});
  box={x:bb.x*cv.r-cv.ox,y:bb.y*cv.r-cv.oy,w:bb.width*cv.r,h:bb.height*cv.r};kind='khuôn mặt';eyes=(b.landmarks||[]).filter(l=>l.type==='eye').map(l=>m(l.locations[0]))}}}catch(_){}
 if(!box){const vw=ov.width/cv.r,vh=ov.height/cv.r;sx.drawImage(s,(cv.W-vw)/2,(cv.H-vh)/2,vw,vh,0,0,96,128);const d=sx.getImageData(0,0,96,128).data,lum=[];for(let i=0;i<d.length;i+=4)lum.push(.3*d[i]+.59*d[i+1]+.11*d[i+2]);
  const mean=lum.reduce((a,b)=>a+b)/lum.length;let sw=0,cx=0,cy=0;
  for(let y=1;y<127;y++)for(let x=1;x<95;x++){const i=y*96+x,e=Math.abs(lum[i]-lum[i+1])+Math.abs(lum[i]-lum[i+96]),w=e*e+Math.abs(lum[i]-mean);sw+=w;cx+=x*w;cy+=y*w}
  if(sw>0){cx=cx/sw/96*ov.width;cy=cy/sw/128*ov.height;const z=ov.width*.3;box={x:cx-z/2,y:cy-z/2,w:z,h:z}}}
 subj=box?{box,eyes,kind}:null}
function plan(){
 const w=ov.width,h=ov.height,b=subj.box,face=subj.kind==='khuôn mặt',cx=b.x+b.w/2;
 const cy=face&&subj.eyes&&subj.eyes.length?subj.eyes.reduce((a,e)=>a+e.y,0)/subj.eyes.length:b.y+b.h*(face?.4:.5);
 const env=sceneOf();
 let z=1,why='giữ góc nhìn tự nhiên';
 if(env==='portrait'&&face){z=clamp(.48*w/Math.max(1,b.w),1.15,2.2);why='làm nổi bật khuôn mặt';}
 else if(env==='group'){z=1;why='giữ góc rộng để không bỏ sót người';}
 else if(env==='landscape'){z=1;why='giữ trọn không gian phong cảnh';}
 else if(env==='sunset'){z=1;why='giữ cả bầu trời và đường chân trời';}
 else if(env==='night'){z=1;why='hạn chế zoom số để giữ chi tiết trong tối';}
 else if(env==='backlight'){z=1;why='giữ khung hình ổn định, ưu tiên cân bằng sáng';}
 else if(env==='doc'){z=1;why='giữ toàn bộ trang tài liệu';}
 else if(face){z=clamp(.42*w/Math.max(1,b.w),1.1,1.8);why='cân đối khuôn mặt trong khung';}
 const centered=env==='group'||env==='landscape'||env==='sunset'||env==='doc'||(face&&Math.abs(cx-w/2)<.12*w);
 const X=centered?w/2:(cx<w/2?w/3:2*w/3);
 const Y=env==='group'?h/2:(face?h*.36:(cy<h/2?h/3:2*h/3));
 const tx=clamp(X-z*cx,w-z*w,0),ty=clamp(Y-z*cy,h-z*h,0);
 const names={portrait:'Chân dung',group:'Ảnh nhóm',backlight:'Ngược sáng',night:'Thiếu sáng',doc:'Tài liệu',sunset:'Hoàng hôn',landscape:'Phong cảnh',general:'Cảnh thông thường'};
 return{z,tx,ty,txt:`${names[env]||'Phân tích cảnh'} · ${z.toFixed(1)}× · ${why}`};
}
function ui(txt,ok,btns=[]){const s=$('sug'),b=$('sugBtn');s.style.display=aiOn?'block':'none';b.style.display=aiOn&&btns.length?'flex':'none';if(!aiOn)return;
 s.textContent=txt;s.classList.toggle('ok',!!ok);const sig=btns.map(x=>x[0]).join();if(sig!==sg.sig){sg.sig=sig;b.innerHTML=btns.map(([id,l,c])=>`<button data-a="${id}" class="${c||''}">${l}</button>`).join('')}}
const applied=()=>ui(`Đã chuyển khung AI · ${F.z.toFixed(1)}×`,true,[['undo','Hoàn tác','no']]);
function suggest(){const w=ov.width,h=ov.height,now=performance.now();
 if(!subj){sg.hold=0;sg.q=null;sg.p=null;return F.on?applied():ui('Hướng máy vào chủ thể…',false)}
 const p=plan(),q=sg.q;sg.q=q?{z:q.z+(p.z-q.z)*.5,tx:q.tx+(p.tx-q.tx)*.5,ty:q.ty+(p.ty-q.ty)*.5,txt:p.txt}:p;sg.hold++;
 const c=F.on?F:{z:digital,tx:w*(1-digital)/2,ty:h*(1-digital)/2},d=Math.abs(sg.q.z-c.z)>.15||Math.abs(sg.q.tx-c.tx)>.05*w||Math.abs(sg.q.ty-c.ty)>.05*h;
 if(sg.hold<3||now<sg.until){sg.p=null;return F.on?applied():ui(sg.hold<3?'Đang phân tích bố cục…':'AI đang theo dõi…',false)}
 if(d){sg.p=sg.q;ui(sg.q.txt,false,[['yes','Đồng ý'],['no','Bỏ qua','no']])}
 else{sg.p=null;F.on?applied():ui('Bố cục đã đẹp – chụp đi!',true)}}
function accept(){if(!sg.p)return;Object.assign(F,{on:true,z:sg.p.z,tx:sg.p.tx,ty:sg.p.ty});sg.p=null;sg.hold=0;sg.until=performance.now()+1200;applied()}
function dismiss(){sg.p=null;sg.hold=0;sg.until=performance.now()+8000;F.on?applied():ui('AI đang theo dõi…',false)}
function undo(){F.on=false;sg.p=null;sg.hold=0;sg.until=performance.now()+5000;ui('Đã về khung gốc',false)}

const SCN={portrait:['Chân dung','Chuyển sang chế độ Chân dung','portrait'],group:['Chụp nhóm','Lùi ra một chút để lấy đủ mọi người',null],backlight:['Ngược sáng','Mặt tối hơn nền – thử tăng EV',null,'ev'],night:['Thiếu sáng','Chế độ Đêm gộp nhiều khung để giảm nhiễu','night'],doc:['Tài liệu','Giữ máy thẳng góc, tránh bóng đổ',null],sunset:['Hoàng hôn','Giữ EV thấp để không cháy sáng',null],landscape:['Phong cảnh','Đặt đường chân trời ở đường lưới 1/3',null],general:['Cảnh thông thường','',null]};
const SC_VN={portrait:'chân dung',group:'nhóm',backlight:'ngược sáng',night:'thiếu sáng',doc:'tài liệu',sunset:'hoàng hôn',landscape:'phong cảnh',general:''},MODE_VN={photo:'Ảnh',portrait:'Chân dung',night:'Đêm',pro:'Pro'};
const scn={k:'general',raw:'',n:0,dis:{},busy:false,cloud:null};
function sceneReset(){scn.k='general';scn.raw='';scn.n=0;scn.cloud=null;drawScene()}
function sceneOf(){if(!ov.width)return'general';const s=src(),cv=cover(s),vw=ov.width/cv.r,vh=ov.height/cv.r;sx.drawImage(s,(cv.W-vw)/2,(cv.H-vh)/2,vw,vh,0,0,96,128);
 const d=sx.getImageData(0,0,96,128).data,N=12288,L=new Float32Array(N);let m=0,dark=0,bright=0,sat=0,warm=0,tR=0,tB=0,bG=0,bB=0,edge=0;
 for(let i=0,p=0;i<N;i++,p+=4){const r=d[p],g=d[p+1],b=d[p+2],y=.3*r+.59*g+.11*b,row=(i/96)|0;L[i]=y;m+=y;if(y<40)dark++;if(y>225)bright++;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx)sat+=(mx-mn)/mx;if(r>b+35)warm++;if(row<42){tR+=r;tB+=b}else if(row>=85){bG+=g;bB+=b}}
 for(let y=0;y<127;y++)for(let x=0;x<95;x++){const i=y*96+x;if(Math.abs(L[i]-L[i+1])+Math.abs(L[i]-L[i+96])>60)edge++}
 m/=N;dark/=N;bright/=N;sat/=N;warm/=N;edge/=N;tR/=4032;tB/=4032;bG/=4128;bB/=4128;
 if(subj&&subj.kind==='khuôn mặt'){const b=subj.box,x0=clamp(b.x*96/ov.width|0,0,95),x1=clamp((b.x+b.w)*96/ov.width|0,x0+1,96),y0=clamp(b.y*128/ov.height|0,0,127),y1=clamp((b.y+b.h)*128/ov.height|0,y0+1,128);let fl=0,c=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){fl+=L[y*96+x];c++}fl/=c;
  if(m>85&&fl<m-35)return'backlight';if(m<60&&fl<50)return'night';if(facesN>=3)return'group';return'portrait'}
 if(m<45&&dark>.55)return'night';if(m<80)return'night';
 if(m>135&&sat<.14&&bright>.3&&edge>.05)return'doc';
 if(warm>.45&&sat>.35&&m>60&&m<175)return'sunset';
 if(tB>tR+8&&tB>110&&bG>bB&&sat>.22)return'landscape';
 return'general'}
function sceneStep(){if(!aiOn)return;const k=sceneOf();if(k===scn.raw)scn.n++;else{scn.raw=k;scn.n=1}if(scn.n>=3&&k!==scn.k){scn.k=k;scn.cloud=null}drawScene()}
function drawScene(){const el=$('scene');el.style.display=aiOn?'flex':'none';if(!aiOn)return;
 const k=scn.k,i=SCN[k],hid=scn.dis[k]>Date.now(),sw=i[2]&&i[2]!==mode;let txt,act=null;
 if(scn.cloud){txt=scn.cloud.txt;if(scn.cloud.mode&&scn.cloud.mode!==mode)act=['Chuyển '+MODE_VN[scn.cloud.mode],scn.cloud.mode]}
 else{txt=i[0]+((!hid&&i[1]&&(i[2]?sw:true))?' · '+i[1]:'');if(!hid){if(sw)act=['Chuyển',i[2]];else if(i[3]==='ev')act=['Tăng EV','ev']}}
 $('sceneTxt').textContent=txt;const g=$('sceneGo');g.style.display=act?'inline-block':'none';if(act){g.textContent=act[0];g.dataset.a=act[1]}
 $('sceneNo').style.display=(act||scn.cloud)?'inline-block':'none'}
function adjustEV(dv){const c=camCaps.exposureCompensation,lo=c?c.min:-3,hi=c?c.max:3;P.ev=clamp(+(P.ev+dv).toFixed(2),lo,hi);if(hardwareEV)applyRealCameraControl('exposureCompensation',P.ev);applyView();syncPro();note('EV '+P.ev.toFixed(1))}
async function askScene(){if(scn.busy)return;try{aiNeed()}catch(e){scn.cloud={txt:''+e.message};drawScene();return}
 scn.busy=true;$('sceneAsk').disabled=true;$('sceneTxt').textContent='Gemini đang nhận diện…';
 try{const s=src(),cr=crop(s),k=Math.min(1,768/Math.max(cr[2],cr[3])),c=document.createElement('canvas');c.width=Math.round(cr[2]*k);c.height=Math.round(cr[3]*k);c.getContext('2d').drawImage(s,...cr,0,0,c.width,c.height);
  const b=await blobOf(c,.85),j=await gem($('mTxt').value,[{inline_data:{mime_type:'image/jpeg',data:await b64(b)}},{text:'Nhìn khung hình camera này. Chỉ trả về JSON: {"scene":"cảnh hoặc chủ thể chính bằng tiếng Việt, tối đa 6 từ","mode":"photo|portrait|night|pro","tip":"1 lời khuyên chụp ngắn bằng tiếng Việt, tối đa 90 ký tự"}. mode=night nếu thiếu sáng, portrait nếu người là chủ thể.'}],{responseMimeType:'application/json',temperature:.2},{timeout:30000});
  const r=jparse(txtOf(j)),md=['photo','portrait','night','pro'].includes(r.mode)?r.mode:null;scn.cloud={txt:''+String(r.scene||'').slice(0,40)+(r.tip?' · '+String(r.tip).slice(0,90):''),mode:md};aiLog('Nhận diện camera: '+r.scene)}
 catch(e){scn.cloud={txt:''+e.message}}
 finally{scn.busy=false;$('sceneAsk').disabled=false;drawScene();const mine=scn.cloud;setTimeout(()=>{if(scn.cloud===mine){scn.cloud=null;drawScene()}},12000)}}

/* ============ 8) GẮN SỰ KIỆN — app.js gọi initAI() một lần khi khởi động ============ */
function initAI(){
 $('gOk').checked=ls('aiOk')==='1';
 $('mTxt').value=ls('mTxt','gemini-2.5-flash');$('mImg').value=ls('mImg','gemini-2.5-flash-image');$('tAuto').checked=ls('tAuto')==='1';
 $('gOk').onchange=()=>{lset('aiOk',$('gOk').checked?'1':'0');stat()};
 $('mTxt').onchange=()=>lset('mTxt',$('mTxt').value.trim());$('mImg').onchange=()=>lset('mImg',$('mImg').value.trim());
 $('tAuto').onchange=()=>lset('tAuto',$('tAuto').checked?'1':'0');
 stat();
 $('aiCaps').innerHTML=[[!!FD,'Nhận diện khuôn mặt (FaceDetector)',FD?'':' – trình duyệt này không có, dùng ước lượng chủ thể'],[true,'Nhận diện cảnh & gợi ý khung hình',''],[true,'Giảm nhiễu, làm nét, xếp chồng khung chụp đêm',''],[true,'Phong cách AI, cắt khung AI, hoàn tác/làm lại','']].map(([ok,t,x])=>`<li>${ok?'✓':'✗'} ${t}${x}</li>`).join('');
 $('gCancel').onclick=()=>aiCtl&&aiCtl.abort('user');$('tiX').onclick=()=>aiCtl&&aiCtl.abort('user');
 $('gTest').onclick=()=>aiRun('Đang kiểm tra',async()=>{await gem($('mTxt').value,[{text:'Trả lời đúng một từ: OK'}],{maxOutputTokens:16});stat('Kết nối thành công với '+$('mTxt').value+'.');aiLog('Kiểm tra kết nối: OK')},$('gStat'),null);
 $('gAna').onclick=()=>cur?aiRun('Gemini đang phân tích ảnh',async()=>{const a=await analyzePhoto(cur.id);renderAna(a);$('gMsg').textContent='Đã nhận diện và gắn thẻ ảnh.'}):($('gMsg').textContent='Hãy chọn ảnh trong Thư viện trước.');
 /* Studio cục bộ */
 $('sAuto').onclick=autoAdjust;
 $('presets').innerHTML=Object.keys(PRE).map(n=>`<button class="chip" data-p="${esc(n)}">${esc(n)}</button>`).join('');
 $('presets').onclick=e=>{const n=e.target.dataset.p;if(!n)return;if(!cur){$('gMsg').textContent='Hãy chọn ảnh trong Thư viện trước.';return}preN=n;document.querySelectorAll('#presets .chip').forEach(b=>b.classList.toggle('on',b.dataset.p===n));applyPreset();pushH()};
 $('pK').oninput=()=>{$('oK').textContent=$('pK').value;applyPreset()};$('pK').onchange=()=>pushH();
 $('cAI').onclick=()=>cur?aiCrop():($('gMsg').textContent='Hãy chọn ảnh trong Thư viện trước.');
 $('cRst').onclick=async()=>{if(!cur||!cropR)return;cropR=null;await buildBase();render();pushH();$('gMsg').textContent='Đã bỏ cắt khung.'};
 /* Gemini: gợi ý thông số */
 $('gAdj').onclick=()=>cur?aiRun('Gemini đang phân tích',async()=>{
  const sc=cur.scene||'',j=await gem($('mTxt').value,[await imgPart(cur.cur||cur.orig,1280),{text:`Bạn là nhiếp ảnh gia chuyên nghiệp. Yêu cầu: ${$('gPr').value||'Chỉnh ảnh đẹp tự nhiên.'}${sc?' Loại cảnh: '+sc+'.':''} Chỉ trả về JSON gồm các khoá ex(-3..3), ct,hl,sh,tp,sa,cl(-100..100), vg,nr,sp(0..100). Chỉ thêm khoá cần đổi.`}],{responseMimeType:'application/json',temperature:.3});
  const e=cleanE(jparse(txtOf(j)));if(!Object.keys(e).length)throw Error('AI không đề xuất thông số hợp lệ.');
  setE({...E,...e});render();pushH();$('gMsg').textContent='Đã áp dụng '+Object.keys(e).length+' thông số từ Gemini (↶ để hoàn tác).'}):($('gMsg').textContent='Hãy chọn ảnh trong Thư viện trước.');
 /* Gemini: tạo/thay đổi nội dung */
 $('kinds').innerHTML=Object.entries(KINDS).map(([k,v])=>`<button class="chip${k===aiKind?' on':''}" data-k="${k}">${v[0]}</button>`).join('');
 kHint();
 $('kinds').onclick=e=>{const k=e.target.dataset.k;if(!k)return;aiKind=k;document.querySelectorAll('#kinds .chip').forEach(b=>b.classList.toggle('on',b.dataset.k===k));kHint()};
 $('rCmp').onclick=()=>{if(!resP||!resP.meta.orig)return;showOrig=!showOrig;if(showOrig&&!origUrl)origUrl=URL.createObjectURL(resP.meta.orig);$('rImg').src=showOrig?origUrl:resUrl;$('rCmp').textContent=showOrig?'Xem kết quả AI':'Xem ảnh gốc'};
 $('rSave').onclick=async()=>{const id=await saveRes();if(id){closeRes();$('gMsg').textContent='Đã lưu ảnh AI (nhãn AI) vào Thư viện.';$('tiSt').textContent='Đã lưu ảnh AI vào Thư viện.';loadGal()}};
 $('rOpen').onclick=async()=>{const id=await saveRes();if(id){closeRes();openStudio(id)}};
 $('rClose').onclick=closeRes;$('aiRes').onclick=e=>{if(e.target===$('aiRes'))closeRes()};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('aiRes').classList.contains('on'))closeRes();if(e.key==='Escape'&&$('camSettings').classList.contains('on'))closeSettings()});
 $('gGen').onclick=()=>{if(!cur){$('gMsg').textContent='Hãy chọn ảnh trong Thư viện trước.';return}const k=KINDS[aiKind],t=$('gPr').value.trim();
  if(['free','rm','bg','sty'].includes(aiKind)&&!t){$('gMsg').textContent='Hãy nhập mô tả cho mục “'+k[0]+'”.';return}
  aiRun('Gemini đang tạo ảnh (có thể mất 10–30 giây)',async()=>{const src0=cur.cur||cur.orig,j=await gem($('mImg').value,[{text:k[2](t)},await imgPart(src0,1536)],{responseModalities:['TEXT','IMAGE']},{timeout:120000}),r=imgOf(j);
   await showResult(r.blob,r.text,{kind:aiKind,prompt:t,parent:cur.id,orig:src0});$('gMsg').textContent='Hoàn tất – xem kết quả và chọn lưu hoặc bỏ.'})};
 $('tiGo').onclick=()=>{const t=$('tiPr').value.trim();if(!t){$('tiSt').textContent='Hãy nhập mô tả ảnh.';return}
  aiRun('Đang tạo ảnh',async()=>{const ar=$('tiAr').value,j=await gem($('mImg').value,[{text:`Generate an image (aspect ratio ${ar}) of: ${t}`}],{responseModalities:['TEXT','IMAGE']},{timeout:120000}),r=imgOf(j);
   await showResult(r.blob,r.text,{kind:'text2img',prompt:t});$('tiSt').textContent='Hoàn tất – xem kết quả và chọn lưu hoặc bỏ.'},$('tiSt'),$('tiX'))};
 /* Gắn thẻ hàng loạt */
 $('bBatch').onclick=async()=>{try{aiNeed()}catch(e){$('batchSt').textContent=e.message;return}
  const all=(await dbAll()).filter(p=>!p.tags&&!p.ai).sort((a,b)=>b.t-a.t);if(!all.length){$('batchSt').textContent='Tất cả ảnh đã có thẻ.';return}
  if(!confirm(`Gửi ${all.length} ảnh (đã thu nhỏ) tới Gemini để phân tích và gắn thẻ?`))return;
  batchStop=false;$('bBatchX').style.display='inline-block';let ok=0,i=0,err='';
  for(const p of all){if(batchStop)break;$('batchSt').textContent=`Đang phân tích ${++i}/${all.length}…`;try{await analyzePhoto(p.id);ok++}catch(e){if(!batchStop)err=e.message;break}await new Promise(r=>setTimeout(r,600))}
  $('bBatchX').style.display='none';$('batchSt').textContent=err?`Dừng do lỗi: ${err} (đã xong ${ok}/${all.length}).`:`${batchStop?'Đã dừng':'Xong'}: ${ok}/${all.length} ảnh đã gắn thẻ.`;loadGal()};
 $('bBatchX').onclick=()=>{batchStop=true;aiCtl&&aiCtl.abort('user')};
 /* Camera: khung hình & cảnh */
 $('sugBtn').onclick=e=>{const a=e.target.dataset.a;if(a==='yes')accept();else if(a==='no')dismiss();else if(a==='undo')undo()};
 $('sceneGo').onclick=()=>{const a=$('sceneGo').dataset.a;if(a==='ev')adjustEV(.7);else{const b=document.querySelector(`#modes b[data-m="${a}"]`);b&&b.click()}scn.cloud=null;scn.dis[scn.k]=Date.now()+30000;drawScene()};
 $('sceneNo').onclick=()=>{scn.dis[scn.k]=Date.now()+30000;scn.cloud=null;drawScene()};
 $('sceneAsk').onclick=askScene;
}

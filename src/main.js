import {tr,pageCount} from './i18n.js';
import {track,setupAnalytics} from './analytics-ui.js';
import {validateFiles,moveItem,formatBytes} from './core.js';
import {carriesFiles} from './dropzone.js';
import './page-ui.js';
import {readPhoto,renderPhoto,generatePdf,exampleFiles,emptyCrop} from './images.js';

const $=id=>document.getElementById(id);
let photos=[],busy=false,controller=null,resultUrl=null,cropIndex=-1,cropDraft=null,cropVersion=0;
let downloadTracked=false,feedbackTracked=false;
const inputSource=()=>{const kinds=new Set(photos.map(p=>p.source));return kinds.size>1?'mixed':kinds.has('file')?'file':'sample';};
const taskEvent=(name,extra={})=>track(name,{input_source:inputSource(),...extra});
function error(message=''){$('error').textContent=message;$('error').hidden=!message;}
function invalidate(){if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=null;$('result').hidden=true;$('download').removeAttribute('href');$('pdf-preview').removeAttribute('src');$('pdf-preview').hidden=true;$('preview').textContent=tr('预览 PDF','Preview PDF');}
function setBusy(value){busy=value;for(const id of ['choose','example','files','limit','filename','clear'])$(id).disabled=value;$('generate').disabled=value||!photos.length;document.querySelectorAll('.photo button').forEach(b=>{b.disabled=value||b.dataset.boundary==='true';});$('drop').setAttribute('aria-busy',String(value));}
function render(){
 $('session').hidden=!photos.length;$('count').textContent=pageCount(photos.length);$('photos').replaceChildren();
 photos.forEach((photo,index)=>{
  const card=document.createElement('article');card.className='photo';
  const image=document.createElement('img');image.src=photo.thumb;image.alt=tr(`第 ${index+1} 页预览`,`Page ${index+1} preview`);card.append(image);
  const badge=document.createElement('span');badge.className='photo-number';badge.textContent=index+1;card.append(badge);
  const name=document.createElement('div');name.className='photo-name';name.textContent=photo.file.name;name.title=photo.file.name;card.append(name);
  const controls=document.createElement('div');controls.className='photo-actions';
  for(const [action,label,boundary] of [['up',tr('前移','Move earlier'),index===0],['down',tr('后移','Move later'),index===photos.length-1],['rotate',tr('旋转','Rotate'),false],['crop',tr('裁边','Crop'),false],['delete',tr('删除','Remove'),false]]){
   const b=document.createElement('button');b.textContent=label;b.setAttribute('aria-label',tr(`第 ${index+1} 页${label}`,`Page ${index+1} ${label}`));b.dataset.boundary=String(boundary);b.disabled=busy||boundary;b.onclick=()=>edit(index,action);controls.append(b);
  }
  card.append(controls);$('photos').append(card);
 });setBusy(busy);
}
async function thumbnail(photo){const blob=await renderPhoto(photo,{edge:420,quality:.8});URL.revokeObjectURL(photo.thumb);photo.thumb=URL.createObjectURL(blob);}
async function edit(index,action){
 if(busy)return;error();
 if(action==='crop'){cropIndex=index;cropDraft={...photos[index].crop};openCrop();return;}
 invalidate();
 if(action==='up'||action==='down')photos=moveItem(photos,index,action==='up'?-1:1);
 if(action==='delete'){URL.revokeObjectURL(photos[index].thumb);photos.splice(index,1);}
 if(action==='rotate'){
   setBusy(true);const photo=photos[index],previous=photo.rotation;photo.rotation=(photo.rotation+90)%360;
   try{await thumbnail(photo);}catch(e){photo.rotation=previous;error(e.message);}finally{setBusy(false);}
 }
 render();
}
async function addFiles(files,source='file'){
 if(busy||!files.length)return;
 const invalid=validateFiles(files,photos.map(p=>p.file));if(invalid){error(invalid);track('generate_error',{input_source:source,error_code:'input_rejected'});$('files').value='';return;}
 setBusy(true);error();const staged=[];$('progress').hidden=false;$('cancel').hidden=true;
 try{for(const [i,file] of files.entries()){$('progress-text').textContent=tr(`正在读取第 ${i+1} / ${files.length} 张照片…`,`Reading photo ${i+1} of ${files.length}…`);$('bar').value=i/files.length;staged.push({...await readPhoto(file),source});}const starting=!photos.length;invalidate();photos.push(...staged);if(starting)taskEvent('tool_start');taskEvent('photos_added');}
 catch(e){track('generate_error',{input_source:source,error_code:'decode_failed'});staged.forEach(p=>URL.revokeObjectURL(p.thumb));error(e.message||tr('无法读取照片，请重试。','Could not read these photos. Please try again.'));}
 finally{setBusy(false);render();$('files').value='';$('progress').hidden=true;$('cancel').hidden=false;}
}
$('choose').onclick=()=>$('files').click();$('files').onchange=e=>addFiles([...e.target.files]);
let dragDepth=0;
$('drop').addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;if(!busy)$('drop').classList.add('dragover');});
$('drop').addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect=busy?'none':'copy';if(!busy)$('drop').classList.add('dragover');});
$('drop').addEventListener('dragleave',e=>{e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop').classList.remove('dragover');});
$('drop').addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop').classList.remove('dragover');addFiles([...(e.dataTransfer?.files??[])]);});
// Never let a drop outside the target navigate away and discard the user's session.
for(const type of ['dragover','drop'])window.addEventListener(type,e=>{if(carriesFiles(e))e.preventDefault();});
$('example').onclick=async()=>{if(busy)return;setBusy(true);try{const files=await exampleFiles();setBusy(false);await addFiles(files,'sample');}catch(e){error(e.message);setBusy(false);}};
$('clear').onclick=()=>{if(busy)return;photos.forEach(p=>URL.revokeObjectURL(p.thumb));photos=[];invalidate();error();render();};
$('limit').onchange=()=>invalidate();$('filename').oninput=()=>{if(resultUrl)$('download').download=downloadName();};
function downloadName(){const value=$('filename').value.trim().replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,60);return `${value||tr('整理好的材料','prepared-documents')}.pdf`;}
$('generate').onclick=async()=>{
 if(busy||!photos.length)return;
 invalidate();error();setBusy(true);controller=new AbortController();$('progress').hidden=false;$('cancel').disabled=false;
 taskEvent('generate_start');downloadTracked=false;feedbackTracked=false;document.querySelectorAll('[data-feedback]').forEach(b=>b.disabled=false);$('feedback-status').textContent='';
 try{
   const limit=Number($('limit').value),result=await generatePdf(photos,limit,{signal:controller.signal,onProgress:(text,progress)=>{$('progress-text').textContent=text;$('bar').value=progress;}});
   if(!result.fits){taskEvent('generate_error',{error_code:'too_large'});error(tr(`这 ${photos.length} 页整理后仍有 ${formatBytes(result.bytes.length)}，超过 ${formatBytes(limit)}。为避免文字过糊，已停止继续压缩。请减少页数、裁去无关边缘，或选择网站允许的更大上限。`,`${photos.length} pages still need ${formatBytes(result.bytes.length)}, above ${formatBytes(limit)}. Compression has stopped to protect readability. Try fewer pages, crop unused edges or choose a larger permitted limit.`));return;}
   resultUrl=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));
   $('result-title').textContent=tr('文件大小已符合要求','Your PDF fits the limit');$('stats').textContent=tr(`${photos.length} 页 · ${formatBytes(result.bytes.length)} · 上限 ${formatBytes(limit)}`,`${pageCount(photos.length)} · ${formatBytes(result.bytes.length)} · Limit ${formatBytes(limit)}`);
   $('quality').textContent=result.profile.edge<1700?tr('本次压缩较多，请先预览并放大检查小字。若不清楚，建议减少页数后再试。','This PDF needed stronger compression. Zoom in and check small text. Try fewer pages if it is unclear.'):tr('已按顺序整理完成。下载前，请预览确认每一页都清楚、完整。','Pages are ready in the order shown. Preview to check that every page is complete and readable.');
   $('download').href=resultUrl;$('download').download=downloadName();$('result').hidden=false;taskEvent('pdf_ready');
   $('result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
 }catch(e){if(e.name==='AbortError')taskEvent('generate_cancel');else taskEvent('generate_error',{error_code:'generation_failed'});error(e.name==='AbortError'?tr('已取消，原照片和顺序都已保留。','Cancelled. Your photos and page order are preserved.'):`${tr('整理未完成：','Could not finish: ')}${e.message||tr('请减少照片后重试。','Please try again with fewer photos.')}`);}
 finally{controller=null;$('progress').hidden=true;setBusy(false);}
};
$('download').addEventListener('click',()=>{if(resultUrl&&!downloadTracked){downloadTracked=true;taskEvent('download_click');}});
$('cancel').onclick=()=>{controller?.abort();$('cancel').disabled=true;$('progress-text').textContent=tr('正在停止…','Stopping…');};
$('preview').onclick=()=>{const frame=$('pdf-preview');frame.hidden=!frame.hidden;if(!frame.hidden)frame.src=resultUrl;$('preview').textContent=frame.hidden?tr('预览 PDF','Preview PDF'):tr('收起预览','Hide preview');};

function openCrop(){
 $('crop-inputs').replaceChildren();
 for(const [key,label] of [['left',tr('左边裁去','Crop left')],['right',tr('右边裁去','Crop right')],['top',tr('上边裁去','Crop top')],['bottom',tr('下边裁去','Crop bottom')]]){
  const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='range';input.min='0';input.max='40';input.step='1';input.value=Math.round(cropDraft[key]*100);input.setAttribute('aria-label',label);const value=document.createElement('output');value.textContent=`${input.value}%`;
  input.oninput=()=>{cropDraft[key]=Number(input.value)/100;value.textContent=`${input.value}%`;drawCrop();};row.append(input,value);$('crop-inputs').append(row);
 }
 $('crop-dialog').showModal();drawCrop();
}
async function drawCrop(){
 const version=++cropVersion;
 try{const canvas=await renderPhoto({...photos[cropIndex],crop:cropDraft},{edge:800,quality:.8},true);if(version!==cropVersion){canvas.width=canvas.height=1;return;}const preview=$('crop-preview');preview.width=canvas.width;preview.height=canvas.height;preview.getContext('2d').drawImage(canvas,0,0);canvas.width=canvas.height=1;}
 catch(e){error(e.message);$('crop-dialog').close();}
}
$('crop-reset').onclick=()=>{cropDraft=emptyCrop();$('crop-dialog').close();openCrop();};
$('crop-cancel').onclick=()=>{$('crop-dialog').close();++cropVersion;};
$('crop-save').onclick=async()=>{if(busy)return;const photo=photos[cropIndex],previous=photo.crop;photo.crop={...cropDraft};$('crop-dialog').close();++cropVersion;invalidate();setBusy(true);try{await thumbnail(photo);}catch(e){photo.crop=previous;error(e.message);}finally{setBusy(false);render();}};
$('feedback-open').onclick=()=>$('feedback-dialog').showModal();$('feedback-close').onclick=()=>$('feedback-dialog').close();
$('feedback-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('feedback-text').value);$('feedback-status').textContent=tr('已复制，可粘贴给邀请你试用的人。','Copied. You can share these notes with the person who invited you.');}catch{$('feedback-text').select();$('feedback-status').textContent=tr('浏览器未允许自动复制，请手动复制已选中的文字。','Automatic copying was blocked. Please copy the selected notes manually.');}};
window.addEventListener('beforeunload',e=>{if(photos.length){e.preventDefault();e.returnValue='';}});
render();

setupAnalytics();

for(const button of document.querySelectorAll('[data-feedback]'))button.onclick=()=>{if(!resultUrl||feedbackTracked)return;const queued=taskEvent('feedback_response',{feedback_result:button.dataset.feedback});feedbackTracked=true;document.querySelectorAll('[data-feedback]').forEach(b=>b.disabled=true);$('feedback-status').textContent=queued?tr('谢谢。已尝试发送分类反馈；网络拦截可能阻止送达。文字备注不会发送。','Thank you. Category feedback was queued; network blocking may prevent delivery. Your notes are never sent.'):tr('当前未允许统计，因此未发送反馈。你仍可复制下面的文字。','Analytics is off, so no feedback was sent. You can still copy your notes below.');};

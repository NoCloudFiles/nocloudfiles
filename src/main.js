import './style.css';
import {validateFiles,moveItem} from './core.js';
import {readPhoto,renderPhoto,generatePdf,exampleFiles,emptyCrop} from './images.js';

const $=id=>document.getElementById(id);
let photos=[],busy=false,controller=null,resultUrl=null,cropIndex=-1,cropDraft=null,cropVersion=0;
const formatBytes=n=>n<1_000_000?`${(n/1000).toFixed(1)} KB`:`${(n/1_000_000).toFixed(2)} MB`;
function error(message=''){$('error').textContent=message;$('error').hidden=!message;}
function invalidate(){if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=null;$('result').hidden=true;$('download').removeAttribute('href');$('pdf-preview').removeAttribute('src');$('pdf-preview').hidden=true;$('preview').textContent='预览 PDF';}
function setBusy(value){busy=value;for(const id of ['choose','example','files','limit','filename','clear'])$(id).disabled=value;$('generate').disabled=value||!photos.length;document.querySelectorAll('.photo button').forEach(b=>{b.disabled=value||b.dataset.boundary==='true';});$('drop').setAttribute('aria-busy',String(value));}
function render(){
 $('session').hidden=!photos.length;$('count').textContent=`共 ${photos.length} 页`;$('photos').replaceChildren();
 photos.forEach((photo,index)=>{
  const card=document.createElement('article');card.className='photo';
  const image=document.createElement('img');image.src=photo.thumb;image.alt=`第 ${index+1} 页预览`;card.append(image);
  const badge=document.createElement('span');badge.className='photo-number';badge.textContent=index+1;card.append(badge);
  const name=document.createElement('div');name.className='photo-name';name.textContent=photo.file.name;name.title=photo.file.name;card.append(name);
  const controls=document.createElement('div');controls.className='photo-actions';
  for(const [action,label,boundary] of [['up','前移',index===0],['down','后移',index===photos.length-1],['rotate','旋转',false],['crop','裁边',false],['delete','删除',false]]){
   const b=document.createElement('button');b.textContent=label;b.setAttribute('aria-label',`第 ${index+1} 页${label}`);b.dataset.boundary=String(boundary);b.disabled=busy||boundary;b.onclick=()=>edit(index,action);controls.append(b);
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
async function addFiles(files){
 if(busy||!files.length)return;
 const invalid=validateFiles(files,photos.map(p=>p.file));if(invalid){error(invalid);$('files').value='';return;}
 setBusy(true);error();const staged=[];$('progress').hidden=false;$('cancel').hidden=true;
 try{for(const [i,file] of files.entries()){$('progress-text').textContent=`正在读取第 ${i+1} / ${files.length} 张照片…`;$('bar').value=i/files.length;staged.push(await readPhoto(file));}invalidate();photos.push(...staged);}
 catch(e){staged.forEach(p=>URL.revokeObjectURL(p.thumb));error(e.message||'无法读取照片，请重试。');}
 finally{setBusy(false);render();$('files').value='';$('progress').hidden=true;$('cancel').hidden=false;}
}
$('choose').onclick=()=>$('files').click();$('files').onchange=e=>addFiles([...e.target.files]);
for(const type of ['dragenter','dragover'])$('drop').addEventListener(type,e=>{e.preventDefault();if(!busy)$('drop').classList.add('dragover');});
for(const type of ['dragleave','drop'])$('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.remove('dragover');});
$('drop').addEventListener('drop',e=>addFiles([...e.dataTransfer.files]));
// Never let a drop outside the target navigate away and discard the user's session.
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
$('example').onclick=async()=>{if(busy)return;setBusy(true);try{const files=await exampleFiles();setBusy(false);await addFiles(files);}catch(e){error(e.message);setBusy(false);}};
$('clear').onclick=()=>{if(busy)return;photos.forEach(p=>URL.revokeObjectURL(p.thumb));photos=[];invalidate();error();render();};
$('limit').onchange=()=>invalidate();$('filename').oninput=()=>{if(resultUrl)$('download').download=downloadName();};
function downloadName(){const value=$('filename').value.trim().replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,60);return `${value||'整理好的材料'}.pdf`;}
$('generate').onclick=async()=>{
 if(busy||!photos.length)return;
 invalidate();error();setBusy(true);controller=new AbortController();$('progress').hidden=false;$('cancel').disabled=false;
 try{
   const limit=Number($('limit').value),result=await generatePdf(photos,limit,{signal:controller.signal,onProgress:(text,progress)=>{$('progress-text').textContent=text;$('bar').value=progress;}});
   if(!result.fits){error(`这 ${photos.length} 页整理后仍有 ${formatBytes(result.bytes.length)}，超过 ${formatBytes(limit)}。为避免文字过糊，已停止继续压缩。请减少页数、裁去无关边缘，或选择网站允许的更大上限。`);return;}
   resultUrl=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));
   $('result-title').textContent='文件大小已符合要求';$('stats').textContent=`${photos.length} 页 · ${formatBytes(result.bytes.length)} · 上限 ${formatBytes(limit)}`;
   $('quality').textContent=result.profile.edge<1700?'本次压缩较多，请先预览并放大检查小字。若不清楚，建议减少页数后再试。':'已按顺序整理完成。下载前，请预览确认每一页都清楚、完整。';
   $('download').href=resultUrl;$('download').download=downloadName();$('result').hidden=false;
   $('result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
 }catch(e){error(e.name==='AbortError'?'已取消，原照片和顺序都已保留。':`整理未完成：${e.message||'请减少照片后重试。'}`);}
 finally{controller=null;$('progress').hidden=true;setBusy(false);}
};
$('cancel').onclick=()=>{controller?.abort();$('cancel').disabled=true;$('progress-text').textContent='正在停止…';};
$('preview').onclick=()=>{const frame=$('pdf-preview');frame.hidden=!frame.hidden;if(!frame.hidden)frame.src=resultUrl;$('preview').textContent=frame.hidden?'预览 PDF':'收起预览';};

function openCrop(){
 $('crop-inputs').replaceChildren();
 for(const [key,label] of [['left','左边裁去'],['right','右边裁去'],['top','上边裁去'],['bottom','下边裁去']]){
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
$('feedback-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('feedback-text').value);$('feedback-status').textContent='已复制，可粘贴给邀请你试用的人。';}catch{$('feedback-text').select();$('feedback-status').textContent='浏览器未允许自动复制，请手动复制已选中的文字。';}};
window.addEventListener('beforeunload',e=>{if(photos.length){e.preventDefault();e.returnValue='';}});
render();

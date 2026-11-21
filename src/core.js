import {tr} from './i18n.js';
// Decimal units, matching the upload limits users see on other websites (1 MB = 1,000,000 bytes).
export function formatBytes(n){
 if(!Number.isFinite(n)||n<0)return '';
 if(n<1000)return `${Math.round(n)} B`;
 if(n<999_950)return `${(n/1000).toFixed(1)} KB`;
 return `${(n/1_000_000).toFixed(2)} MB`;
}
export function declaredPixels(bytes,type){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(type==='png'&&bytes.length>=24)return view.getUint32(16)*view.getUint32(20);
 if(type==='jpeg'){
  let offset=2;
  while(offset+4<=bytes.length){
   if(bytes[offset]!==255)return null;
   const marker=bytes[offset+1];
   if(marker===218||marker===217)return null;
   if(marker===255){offset++;continue;}
   const length=view.getUint16(offset+2);
   if(length<2)return null;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(offset+9>bytes.length)return null;
    return view.getUint16(offset+5)*view.getUint16(offset+7);
   }
   offset+=length+2;
  }
 }
 return null;
}
export function validateFiles(incoming, existing=[]) {
  const files=[...existing,...incoming];
  if(files.length>20) return tr('一次最多整理 20 张照片，请分批处理。','You can use up to 20 photos at a time. Please split them into batches.');
  if(files.some(f=>!Number.isFinite(f.size)||f.size<=0)) return tr('有空文件，无法读取。请重新选择原照片。','An empty file cannot be read. Please choose the original photo.');
  if(files.some(f=>f.size>20_000_000)) return tr('单张照片不能超过 20 MB，请先缩小这张照片。','Each photo must be 20 MB or smaller. Please resize it first.');
  if(files.reduce((n,f)=>n+f.size,0)>80_000_000) return tr('照片总大小不能超过 80 MB，请分批处理。','Photos must total 80 MB or less. Please split them into batches.');
  return null;
}
export function sniffImage(bytes) {
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';
  if([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'png';
  const s=new TextDecoder('latin1').decode(bytes.subarray(0,32));
  if(s.startsWith('RIFF')&&s.slice(8,12)==='WEBP')return 'webp';
  if(s.slice(4,8)==='ftyp'){
    const brand=s.slice(8,12);
    if(/^(heic|heix|hevc|hevx|heim|heis|hevm|hevs)$/.test(brand)||(brand==='mif1'&&!/avif|avis/.test(s.slice(16,32))))return 'heic';
  }
  return null;
}
export function fitOnPage(width,height) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error(tr('无效图片尺寸','Invalid image dimensions'));
  const [pageWidth,pageHeight]=width>height?[841.89,595.28]:[595.28,841.89];
  const scale=Math.min((pageWidth-40)/width,(pageHeight-40)/height);
  return {pageWidth,pageHeight,width:width*scale,height:height*scale,x:(pageWidth-width*scale)/2,y:(pageHeight-height*scale)/2};
}
export function cropPixels(width,height,{left=0,right=0,top=0,bottom=0}={}) {
  const values=[left,right,top,bottom];
  if(!values.every(n=>Number.isFinite(n)&&n>=0&&n<1)||left+right>=.95||top+bottom>=.95)throw Error(tr('裁剪范围无效','Invalid crop range'));
  return {x:Math.round(width*left),y:Math.round(height*top),width:Math.max(1,Math.round(width*(1-left-right))),height:Math.max(1,Math.round(height*(1-top-bottom)))};
}
export function moveItem(items,index,offset) {
  const out=[...items],target=index+offset;
  if(index>=0&&index<out.length&&target>=0&&target<out.length)[out[index],out[target]]=[out[target],out[index]];
  return out;
}
export const PROFILES=[{edge:2400,quality:.9},{edge:2000,quality:.82},{edge:1700,quality:.72},{edge:1400,quality:.62},{edge:1100,quality:.5}];
export async function fitBudget(build,limit,{signal,onAttempt=()=>{}}={}) {
  if(!Number.isFinite(limit)||limit<=0)throw Error(tr('文件大小上限无效','Invalid file size limit'));
  let result;
  for(let i=0;i<PROFILES.length;i++) {
    signal?.throwIfAborted();onAttempt(i,PROFILES.length);
    const bytes=await build(PROFILES[i]);signal?.throwIfAborted();
    if(!(bytes instanceof Uint8Array)||!bytes.length)throw Error(tr('没有生成有效 PDF','No valid PDF was generated'));
    result={bytes,profile:PROFILES[i],fits:bytes.length<=limit};
    if(result.fits)return result;
  }
  return result;
}

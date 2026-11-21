import {tr} from './i18n.js';
import {PDFDocument} from 'pdf-lib';
import {cropPixels,fitOnPage,sniffImage,fitBudget,declaredPixels} from './core.js';

export const emptyCrop=()=>({left:0,right:0,top:0,bottom:0});
export function canvasBlob(canvas,type='image/jpeg',quality=.9) {
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error(tr('浏览器无法生成图片，请减少照片后重试。','Your browser could not create the image. Please retry with fewer photos.'))),type,quality));
}
async function openBitmap(blob) {
  // Browser decoders apply EXIF orientation; no raw filename or metadata is embedded in output.
  if(typeof createImageBitmap==='function')return createImageBitmap(blob,{imageOrientation:'from-image'});
  const url=URL.createObjectURL(blob),img=new Image();
  try {img.src=url;await img.decode();return img;} finally {URL.revokeObjectURL(url);}
}
export async function readPhoto(file) {
  const header=new Uint8Array(await file.slice(0,262144).arrayBuffer());
  const type=sniffImage(header);
  if(!type)throw Error(tr(`无法读取「${file.name}」。请选择 JPG、PNG、WebP 或 HEIC 照片；当前不支持 PDF、Word 或动态图片。`,`Cannot read “${file.name}”. Choose JPG, PNG, WebP or HEIC photos. PDFs, Word documents and animated images are not supported.`));
  if(declaredPixels(header,type)>36_000_000)throw Error(tr(`「${file.name}」分辨率过高，请先缩小到 3600 万像素以内。`,`“${file.name}” has too many pixels. Resize it to 36 megapixels or less.`));
  let blob=file;
  if(type==='heic') {
    const {heicTo}=await import('heic-to/csp');
    blob=await heicTo({blob:file,type:'image/jpeg',quality:.96});
  }
  let bitmap;
  try {bitmap=await openBitmap(blob);}catch {throw Error(tr(`无法读取「${file.name}」，文件可能已损坏或格式不受支持，请重新导出为 JPG。`,`Cannot read “${file.name}”. It may be damaged or unsupported. Try exporting it as JPG.`));}
  const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;
  bitmap.close?.();
  if(width*height>36_000_000)throw Error(tr(`「${file.name}」分辨率过高，请先缩小到 3600 万像素以内。`,`“${file.name}” has too many pixels. Resize it to 36 megapixels or less.`));
  if(!width||!height)throw Error(tr(`无法读取「${file.name}」的尺寸。`,`Cannot read the dimensions of “${file.name}”.`));
  const photo={id:crypto.randomUUID(),file,blob,width,height,rotation:0,crop:emptyCrop()};
  photo.thumb=URL.createObjectURL(await renderPhoto(photo,{edge:420,quality:.8}));
  return photo;
}
export async function renderPhoto(photo,{edge,quality},returnCanvas=false) {
  const bitmap=await openBitmap(photo.blob);
  try {
    const crop=cropPixels(photo.width,photo.height,photo.crop),turn=photo.rotation%180!==0;
    const w=turn?crop.height:crop.width,h=turn?crop.width:crop.height;
    const scale=Math.min(1,edge/Math.max(w,h));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw Error(tr('当前浏览器不支持图片处理，请使用较新的浏览器。','This browser does not support image processing. Please use a newer browser.'));
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(photo.rotation*Math.PI/180);
    ctx.drawImage(bitmap,crop.x,crop.y,crop.width,crop.height,-crop.width*scale/2,-crop.height*scale/2,crop.width*scale,crop.height*scale);
    if(returnCanvas)return canvas;
    try {return await canvasBlob(canvas,'image/jpeg',quality);} finally {canvas.width=canvas.height=1;}
  }finally{bitmap.close?.();}
}
export async function generatePdf(photos,limit,{signal,onProgress=()=>{}}={}) {
  if(!photos.length)throw Error(tr('请先添加照片。','Please add photos first.'));
  let attempt=0;
  return fitBudget(async profile=>{
    const pdf=await PDFDocument.create();pdf.setTitle('Prepared documents');pdf.setCreator('Paper Ready');pdf.setProducer('Paper Ready / pdf-lib');
    for(let i=0;i<photos.length;i++) {
      signal?.throwIfAborted();onProgress(tr(`正在整理第 ${i+1} / ${photos.length} 页${attempt?'，调整文件大小':''}`,`Preparing page ${i+1} of ${photos.length}${attempt?', adjusting file size':''}`), (attempt+i/photos.length)/5);
      const jpeg=await renderPhoto(photos[i],profile);
      signal?.throwIfAborted();
      const image=await pdf.embedJpg(await jpeg.arrayBuffer()),box=fitOnPage(image.width,image.height);
      const page=pdf.addPage([box.pageWidth,box.pageHeight]);page.drawImage(image,{x:box.x,y:box.y,width:box.width,height:box.height});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return pdf.save();
  },limit,{signal,onAttempt:i=>{attempt=i;}});
}
export async function exampleFiles() {
  const files=[];
  for(let i=1;i<=3;i++) {
    const c=document.createElement('canvas');c.width=1400;c.height=1980;const x=c.getContext('2d');
    x.fillStyle='#faf8ef';x.fillRect(0,0,c.width,c.height);
    x.fillStyle='#2d5747';x.font='bold 54px sans-serif';x.fillText(tr('示例材料 / SAMPLE','SAMPLE DOCUMENT'),100,150);
    x.fillStyle='#69756a';x.font='30px sans-serif';x.fillText(tr(`第 ${i} 页 · 仅用于演示，不含个人信息`,`Page ${i} · Example only, no personal information`),100,215);
    x.strokeStyle='#ccd3c4';x.lineWidth=3;x.strokeRect(100,280,1200,1450);
    x.fillStyle='#465746';x.font='32px sans-serif';
    for(let j=0;j<17;j++)x.fillText(`${String(j+1).padStart(2,'0')}  ${tr("请检查文字是否完整、方向和顺序是否正确。","Check text, orientation and page order.")}`,145,365+j*72);
    x.fillStyle=['#bfba89','#cbd5b4','#b6cacc'][i-1];x.fillRect(100,1770,150,50);
    x.fillStyle='#4c654a';x.font='26px sans-serif';x.fillText('Paper Ready · original example',100,1900);
    files.push(new File([await canvasBlob(c)],tr(`示例材料-${i}.jpg`,`example-page-${i}.jpg`),{type:'image/jpeg'}));c.width=c.height=1;
  }
  return files;
}

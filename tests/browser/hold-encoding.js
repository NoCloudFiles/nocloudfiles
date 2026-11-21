// Hold the first real encoding completion so cancellation cannot race a fast device.
export async function holdEncoding(page){
 await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,...args){HTMLCanvasElement.prototype.toBlob=original;return original.call(this,blob=>{window.releaseEncoding=()=>callback(blob);},...args);};});
}
export async function releaseEncoding(page){
 await page.waitForFunction(()=>typeof window.releaseEncoding==='function');
 await page.evaluate(()=>window.releaseEncoding());
}

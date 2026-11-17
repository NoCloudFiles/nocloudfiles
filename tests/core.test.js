import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateFiles,fitOnPage,cropPixels,moveItem,sniffImage,fitBudget,declaredPixels} from '../src/core.js';
const f=(size=100,name='照片.jpg')=>({size,name});
test('PNG and JPEG dimensions are checked before allocating decoded pixels',()=>{
 const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);const v=new DataView(png.buffer);v.setUint32(16,100000);v.setUint32(20,100000);
 assert.equal(declaredPixels(png,'png'),10_000_000_000);
 const jpg=Uint8Array.from([255,216,255,192,0,17,8,3,232,7,208]);
 assert.equal(declaredPixels(jpg,'jpeg'),2_000_000);
 assert.equal(declaredPixels(Uint8Array.from([255,216,255,192]),'jpeg'),null);
});
test('file limits account for existing files and reject empty, excessive or oversized input',()=>{
  assert.equal(validateFiles([f()],[]),null);
  assert.match(validateFiles([f(0)],[]),/空/);
  assert.match(validateFiles([f(20_000_001)],[]),/20 MB/);
  assert.match(validateFiles([f()],Array(20).fill(f())),/20 张/);
  assert.match(validateFiles([f(20_000_000)],Array(4).fill(f(20_000_000))),/80 MB/);
});
test('sniffs actual content rather than trusting extension or MIME',()=>{
 assert.equal(sniffImage(Uint8Array.from([255,216,255,224])),'jpeg');
 assert.equal(sniffImage(Uint8Array.from([137,80,78,71,13,10,26,10])),'png');
 assert.equal(sniffImage(new TextEncoder().encode('RIFF0000WEBP')),'webp');
 assert.equal(sniffImage(new TextEncoder().encode('\0\0\0\x18ftypheic')),'heic');
 assert.equal(sniffImage(new TextEncoder().encode('%PDF-1.7')),null);
 assert.equal(sniffImage(new TextEncoder().encode('<svg onload="alert(1)">')),null);
});
test('page placement preserves whole image proportions, centers and chooses orientation',()=>{
 const a=fitOnPage(1000,2000); assert.ok(a.pageWidth<a.pageHeight); assert.ok(a.x>=20&&a.y>=20);
 assert.equal(a.width/a.height,.5);
 const b=fitOnPage(2000,1000); assert.ok(b.pageWidth>b.pageHeight); assert.equal(b.width/b.height,2);
 assert.throws(()=>fitOnPage(0,1));
});
test('crop bounds cannot cut everything or escape original image',()=>{
 assert.deepEqual(cropPixels(1000,500,{left:.1,right:.2,top:.1,bottom:.1}),{x:100,y:50,width:700,height:400});
 assert.throws(()=>cropPixels(10,10,{left:.6,right:.6,top:0,bottom:0}));
 assert.throws(()=>cropPixels(10,10,{left:-.1,right:0,top:0,bottom:0}));
});
test('reordering is immutable and respects boundaries',()=>{
 const items=['a','b','c']; assert.deepEqual(moveItem(items,1,-1),['b','a','c']);
 assert.deepEqual(items,['a','b','c']);assert.deepEqual(moveItem(items,0,-1),items);
});
test('size fitting uses actual PDF bytes and stops at first satisfactory quality',async()=>{
 const tried=[]; const result=await fitBudget(async profile=>{tried.push(profile);return new Uint8Array(tried.length===1?1001:1000);},1000);
 assert.equal(tried.length,2);assert.equal(result.bytes.length,1000);assert.equal(result.fits,true);
});
test('impossible limit reports failure rather than labelling oversize PDF as ready',async()=>{
 const result=await fitBudget(async()=>new Uint8Array(2000),1000);
 assert.equal(result.fits,false);assert.equal(result.bytes.length,2000);
});
test('abort and conversion failure do not produce a success',async()=>{
 const c=new AbortController();c.abort();
 await assert.rejects(fitBudget(async()=>new Uint8Array(10),1000,{signal:c.signal}),{name:'AbortError'});
 await assert.rejects(fitBudget(async()=>{throw Error('decoder failed');},1000),/decoder failed/);
});

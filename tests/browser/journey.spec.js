import {holdEncoding,releaseEncoding} from './hold-encoding.js';
import {test,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';
test('example photos become a real downloadable PDF within the chosen limit; edits invalidate output',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/zh/');
 await page.getByRole('button',{name:'用示例试一试'}).click();
 await expect(page.getByText('共 3 页', {exact:true})).toBeVisible();
 await page.getByLabel('第 2 页前移').click();
 await page.getByLabel('第 1 页旋转').click();
 await page.getByRole('button',{name:'整理成 PDF'}).click();
 await expect(page.getByRole('heading',{name:'文件大小已符合要求'})).toBeVisible();
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('link',{name:'下载 PDF'}).click();
 const download=await downloadEvent;
 const bytes=await fs.readFile(await download.path());
 await download.saveAs('test-results/example-output.pdf');
 expect(bytes.length).toBeLessThanOrEqual(1_000_000);
 const doc=await PDFDocument.load(bytes);expect(doc.getPageCount()).toBe(3);
 expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
 await page.getByLabel('第 1 页删除').click();
 await expect(page.getByRole('link',{name:'下载 PDF'})).toHaveCount(0);
 expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/desktop.png',fullPage:true});
});
test('bad file is rejected without discarding already selected photos',async({page})=>{
 await page.goto('/zh/');await page.getByRole('button',{name:'用示例试一试'}).click();
 await expect(page.getByText('共 3 页',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'选择照片',exact:true})).toBeEnabled();
 await page.getByLabel('选择照片').setInputFiles({name:'伪装.jpg',mimeType:'image/jpeg',buffer:Buffer.from('<script>bad</script>')});
 await expect(page.getByRole('alert')).toContainText('无法读取');
 await expect(page.getByText('共 3 页',{exact:true})).toBeVisible();
});
test('mobile layout and crop controls are usable, reset removes the session',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/zh/');
 await page.getByRole('button',{name:'用示例试一试'}).click();
 await page.getByLabel('第 1 页裁边').click();
 await page.getByLabel('左边裁去').fill('12');
 await page.getByRole('button',{name:'保存裁边'}).click();
 await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 await page.getByRole('button',{name:'清空照片'}).click();
 await expect(page.getByRole('button',{name:'整理成 PDF'})).toBeDisabled();
});
test('HEIC photo decodes locally and produces a one-page PDF',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/zh/');
 await page.getByLabel('选择照片').setInputFiles(path.resolve('tests/fixtures/synthetic.heic'));
 await expect(page.getByText('共 1 页',{exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('button',{name:'整理成 PDF'}).click();
 const event=page.waitForEvent('download');await page.getByRole('link',{name:'下载 PDF'}).click();
 const download=await event;const bytes=await fs.readFile(await download.path());
 expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);expect(errors).toEqual([]);
});
test('oversized dimensions are rejected before decoding and another file can be selected',async({page})=>{
 await page.goto('/zh/');const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(100000,16);png.writeUInt32BE(100000,20);
 await page.getByLabel('选择照片').setInputFiles({name:'large.png',mimeType:'image/png',buffer:png});
 await expect(page.getByRole('alert')).toContainText('分辨率过高');
 await page.getByLabel('选择照片').setInputFiles(path.resolve('tests/fixtures/synthetic.png'));
 await expect(page.getByText('共 1 页',{exact:true})).toBeVisible();
});
test('real noisy image is compressed to the requested byte limit',async({page})=>{
 await page.goto('/zh/');
 const base64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1400;c.height=1900;const x=c.getContext('2d'),im=x.createImageData(c.width,c.height);let seed=12345;for(let i=0;i<im.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;im.data[i]=seed&255;im.data[i+1]=(seed>>>8)&255;im.data[i+2]=(seed>>>16)&255;im.data[i+3]=255;}x.putImageData(im,0,0);return c.toDataURL('image/png').split(',')[1];});
 const buffer=Buffer.from(base64,'base64');expect(buffer.length).toBeGreaterThan(1_000_000);
 await page.getByLabel('选择照片').setInputFiles({name:'噪点测试.png',mimeType:'image/png',buffer});
 await expect(page.getByText('共 1 页',{exact:true})).toBeVisible();
 await page.getByLabel('网站允许的文件大小').selectOption('500000');
 await page.getByRole('button',{name:'整理成 PDF'}).click();
 await expect(page.getByRole('heading',{name:'文件大小已符合要求'})).toBeVisible();
 const event=page.waitForEvent('download');await page.getByRole('link',{name:'下载 PDF'}).click();const bytes=await fs.readFile(await (await event).path());
 expect(bytes.length).toBeLessThanOrEqual(500000);expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
});
test('cancellation keeps photos and removes any downloadable partial result',async({page})=>{
 await page.goto('/zh/');await page.getByRole('button',{name:'用示例试一试'}).click();await expect(page.getByText('共 3 页',{exact:true})).toBeVisible();
 await holdEncoding(page);await page.getByRole('button',{name:'整理成 PDF'}).click();await page.getByRole('button',{name:'取消处理'}).click();await releaseEncoding(page);
 await expect(page.getByRole('alert')).toContainText('已取消');await expect(page.getByText('共 3 页',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'下载 PDF'})).toHaveCount(0);await expect(page.getByRole('button',{name:'整理成 PDF'})).toBeEnabled();
});
test('processing photos sends no document content to a server',async({page})=>{
 const writes=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.goto('/zh/');await page.getByRole('button',{name:'用示例试一试'}).click();
 await page.getByRole('button',{name:'整理成 PDF'}).click();
 await expect(page.getByRole('link',{name:'下载 PDF'})).toBeVisible();
 expect(writes).toEqual([]);
 expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
});
test('camera EXIF orientation is honored without a manual rotation',async({page})=>{
 await page.goto('/zh/');await page.getByLabel('选择照片').setInputFiles(path.resolve('tests/fixtures/orientation-6.jpg'));
 await expect(page.getByText('共 1 页',{exact:true})).toBeVisible();await page.getByRole('button',{name:'整理成 PDF'}).click();
 const event=page.waitForEvent('download');await page.getByRole('link',{name:'下载 PDF'}).click();
 const doc=await PDFDocument.load(await fs.readFile(await (await event).path()));
 expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
});
test('production headers and public documentation are present',async({page,request})=>{
 test.setTimeout(120000); // Includes downloading the 5 MB decoder source archive over the public network.
 const response=await page.goto('/zh/');expect(response.headers()['content-security-policy']).toContain("form-action 'none'");
 await page.getByRole('link',{name:'项目说明与测试'}).click();await expect(page.getByRole('heading',{name:'让提交材料少一点折腾'})).toBeVisible();
 for(const url of ['/source.zip','/third-party-notices.txt','/heic-to-source.tgz'])expect((await request.get(url)).status()).toBe(200);
});

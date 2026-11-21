import {chromium,expect} from '@playwright/test';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dryRun=process.env.DRY_RUN==='1',base=process.env.PROBE_URL||'https://paper-ready.1986liubo.workers.dev';
const evidence=`validation/2026-11-21/${dryRun?'wire-check':'live-probe'}.json`;
const browser=await chromium.launch({headless:true,executablePath:`${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`});
try{
 const context=await browser.newContext({viewport:{width:1280,height:960},acceptDownloads:true});const page=await context.newPage();
 if(dryRun)await page.route('https://**.google-analytics.com/**',r=>r.fulfill({status:204,body:''}));
 const requests=[],errors=[];const diagnostics=[];
 page.on('requestfailed',r=>diagnostics.push({host:new URL(r.url()).host,failure:r.failure()?.errorText}));
 page.on('console',m=>{if(m.type()==='error')diagnostics.push({console:m.text().slice(0,300)});});let externalBeforeChoice=0,consented=false;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!consented&&/google(tagmanager|-analytics)/.test(r.url()))externalBeforeChoice++;});
 page.on('response',async response=>{const request=response.request(),u=new URL(request.url());if(!u.hostname.endsWith('google-analytics.com')||!u.pathname.includes('collect'))return;
  for(const line of (request.postData()||'').split('\n')){const q=new URLSearchParams(u.search);for(const [k,v] of new URLSearchParams(line.trim()))q.set(k,v);requests.push({status:response.status(),measurementId:q.get('tid'),event:q.get('en'),source:q.get('ep.input_source'),language:q.get('ep.interface_language'),page:q.get('dl'),debug:q.get('_dbg')||q.get('ep.debug_mode')||q.get('epn.debug_mode')});}
 });
 await page.goto(`${base}/?analytics_debug=1&private_probe=never-send#private-fragment`);
 await page.getByRole('button',{name:'Allow analytics',exact:true}).waitFor();assert.equal(externalBeforeChoice,0);
 consented=true;await page.getByRole('button',{name:'Allow analytics',exact:true}).click();
 await page.getByRole('button',{name:'Try an example',exact:true}).click();await page.getByText('3 pages',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Create PDF',exact:true}).click();await page.getByRole('link',{name:'Download PDF',exact:true}).waitFor();
 const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'Download PDF',exact:true}).click();const download=await downloading;await download.saveAs('validation/2026-11-21/example.pdf');
 await page.screenshot({path:'validation/2026-11-21/english-desktop.png',fullPage:true});
 try{await expect.poll(()=>requests.some(r=>r.event==='download_click'),{timeout:30000}).toBe(true);}finally{await writeFile(evidence,JSON.stringify({dryRun,checkedAt:new Date().toISOString(),externalBeforeChoice,errors,requests,diagnostics},null,2));}
 await page.getByRole('button',{name:'Clear photos',exact:true}).click();await page.goto(`${base}/zh/?analytics_debug=1`);
 await page.getByRole('button',{name:'用示例试一试'}).waitFor();await page.close();
 await context.close();
 await writeFile(evidence,JSON.stringify({dryRun,checkedAt:new Date().toISOString(),externalBeforeChoice,errors,requests},null,2));
 assert.equal(requests.filter(r=>r.event==='page_view'&&r.page===`${base}/`).length,1);
 assert.equal(errors.length,0);assert.ok(requests.some(r=>r.event==='pdf_ready'&&r.source==='sample'));assert.ok(requests.some(r=>r.event==='download_click'));
 assert.ok(requests.every(r=>r.measurementId==='G-94L2V73P1G'&&r.status===204));assert.ok(requests.every(r=>!r.page?.includes('?')&&!r.page?.includes('#')));
 await writeFile(evidence,JSON.stringify({dryRun,checkedAt:new Date().toISOString(),externalBeforeChoice,errors,requests},null,2));
 console.log(JSON.stringify({externalBeforeChoice,errors,events:requests.map(r=>r.event),allCorrectStreamAnd204:true}));
}finally{await browser.close();}

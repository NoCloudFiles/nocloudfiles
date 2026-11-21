// Synthetic launch QA only. Never use customer material in a telemetry probe.
import {chromium,expect} from '@playwright/test';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='https://nocloudfiles.com';
const browser=await chromium.launch({executablePath:`${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`});
const records=[],errors=[];let consented=false,beforeConsent=0;
try{
 const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!consented&&/google(tagmanager|-analytics)/.test(r.url()))beforeConsent++;});
 page.on('response',res=>{
  const r=res.request(),u=new URL(r.url());if(!u.hostname.endsWith('google-analytics.com')||!u.pathname.includes('collect'))return;
  for(const line of (r.postData()||'').split('\n')){
   const p=new URLSearchParams(u.search);for(const[k,v]of new URLSearchParams(line))p.set(k,v);
   const raw=decodeURIComponent(p.toString());assert.ok(!/never-send|private-fragment|Private Author|private-original|25.034|EXIF-CANARY/.test(raw));
   records.push({status:res.status(),event:p.get('en'),measurementId:p.get('tid'),tool:p.get('ep.tool_id'),source:p.get('ep.input_source'),page:p.get('dl')});
  }
 });
 await page.goto(`${base}/photo-privacy/?analytics_debug=1&private_probe=never-send#private-fragment`);
 await page.getByRole('button',{name:'Allow analytics',exact:true}).waitFor();assert.equal(beforeConsent,0);consented=true;
 await page.getByRole('button',{name:'Allow analytics',exact:true}).click();await page.locator('#photo').setInputFiles('tests/fixtures/private-original.heic');
 await page.getByRole('checkbox',{name:'Author',exact:true}).check();
 await page.getByRole('textbox',{name:'Author',exact:true}).fill('EXIF-CANARY');
 await page.getByRole('button',{name:'Create private copy'}).click();
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download still JPEG'}).click();
 await(await download).saveAs('/tmp/nocloudfiles-verified-copy.jpg');
 await expect.poll(()=>records.some(r=>r.event==='download_click'),{timeout:30000}).toBe(true);
 assert.equal(records.filter(r=>r.event==='page_view').length,1);
 for(const event of ['photo_inspected','photo_ready','download_click'])assert.ok(records.some(r=>r.event===event&&r.tool==='photo_privacy'&&r.source==='file'));
 assert.ok(records.every(r=>r.measurementId==='G-94L2V73P1G'&&r.status===204&&r.page===base+'/photo-privacy/'));
 assert.equal(errors.length,0);
 console.log(JSON.stringify({beforeConsent,errors,events:records.map(r=>r.event),correctStream:true}));
}finally{await writeFile('validation/photo-privacy/live-wire.json',JSON.stringify({checkedAt:new Date().toISOString(),beforeConsent,errors,records},null,2));await browser.close();}

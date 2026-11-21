// Run only with the built-in synthetic samples. Save bounded response evidence.
import { chromium, expect } from '@playwright/test';
import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';
const base='https://nocloudfiles.com';
const browser=await chromium.launch({executablePath:homedir()+'/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const evidence=[];
try{
 for(const [route,tool,ready] of [['schedule-to-calendar','schedule_to_calendar','schedule_ready'],['vcf-select','vcf_select','contacts_ready']]){
  const page=await browser.newPage();
  let allowed=false,before=0;const records=[];
  page.on('request',r=>{if(!allowed&&/google(tagmanager|-analytics)/.test(r.url()))before++;});
  page.on('response',r=>{
   const u=new URL(r.url());if(!u.hostname.endsWith('.google-analytics.com')||!u.pathname.includes('collect'))return;
   for(const line of (r.request().postData()||'').split('\n')){
    const p=new URLSearchParams(u.search);for(const [k,v] of new URLSearchParams(line))p.set(k,v);
    expect(decodeURIComponent(p.toString())).not.toMatch(/ncf-private|Alex Lin|Night shift|2027-01-31/);
    records.push([p.get('en'),p.get('ep.tool_id'),p.get('ep.input_source'),p.get('tid'),r.status(),p.get('dl')]);
   }
  });
  await page.goto(base+'/'+route+'/?analytics_debug=1&qa=ncf-private');
  const consent=page.getByRole('button',{name:'Allow analytics',exact:true});await consent.waitFor();allowed=true;await consent.click();
  await page.locator('#sample').click();
  if(route==='vcf-select'){await page.getByLabel('Alex Lin',{exact:true}).check();await page.locator('#build').click();}
  else {await page.locator('#map').click();await page.locator('#review').click();}
  await page.locator('#links a').first().click();
  await expect.poll(()=>records.some(r=>r[0]==='download_click'),{timeout:40000}).toBe(true);
  expect(before).toBe(0);
  for(const name of ['tool_start',ready,'download_click'])expect(records).toContainEqual([name,tool,'sample','G-94L2V73P1G',204,base+'/'+route+'/']);
  evidence.push({tool,before,records});await page.close();
 }
 await writeFile(new URL('./wire.json',import.meta.url),JSON.stringify(evidence,null,2));
 console.log('Both production sample funnels verified.');
}finally{await browser.close();}

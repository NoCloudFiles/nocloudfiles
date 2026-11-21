import test from 'node:test';
import assert from 'node:assert/strict';
import {safeEvent,createAnalytics} from '../src/analytics.js';
test('event payload allows only bounded task metadata and strips private content',()=>{
 assert.deepEqual(safeEvent('pdf_ready',{input_source:'file',interface_language:'en',filename:'private.jpg',message:'private',limit:123}),{input_source:'file',interface_language:'en'});
 assert.equal(safeEvent('private_event',{}),null);
 assert.deepEqual(safeEvent('generate_error',{error_code:'file_secret.jpg',input_source:'bad',interface_language:'fr'}),{});
});
function fixture(choice=null){const sent=[],loads=[];const storage=new Map(choice?[['paper-ready-analytics',choice]]:[]);return {sent,loads,storage,a:createAnalytics({measurementId:'G-TEST1234',language:'en',location:'https://example.org/?private=x#secret',referrer:'https://search.example/search?q=private',getChoice:()=>storage.get('paper-ready-analytics'),saveChoice:v=>storage.set('paper-ready-analytics',v),send:(...args)=>sent.push(args),load:()=>loads.push('load')})};}
test('no analytics before choice or after refusal; core calls are harmless',()=>{const {a,sent,loads}=fixture();a.event('pdf_ready',{input_source:'file'});a.consent(false);a.event('download_click',{});assert.equal(sent.length,0);assert.equal(loads.length,0);assert.equal(a.getConsent(),'denied');});
test('acceptance initializes once, sends sanitized page view and future events only',()=>{
 const {a,sent,loads}=fixture();a.event('tool_start',{input_source:'file'});a.consent(true);a.consent(true);a.event('pdf_ready',{input_source:'file',filename:'secret'});
 assert.equal(loads.length,1);const configs=sent.filter(x=>x[0]==='config');assert.equal(configs.length,1);assert.equal(configs[0][2].page_location,'https://example.org/');assert.equal(configs[0][2].page_referrer,'https://search.example/');assert.equal(configs[0][2].send_page_view,false);
 assert.equal(sent.filter(x=>x[0]==='event'&&x[1]==='page_view').length,1);assert.equal(sent.filter(x=>x[1]==='tool_start').length,0);assert.deepEqual(sent.at(-1),['event','pdf_ready',{input_source:'file',interface_language:'en'}]);assert.ok(!JSON.stringify(sent).includes('secret'));
});
test('withdrawal stops events and persisted consent resumes only on allowed host config',()=>{const {a,sent}=fixture('granted');const before=sent.length;assert.ok(before>0);a.consent(false);const after=sent.length;a.event('pdf_ready',{});assert.equal(sent.length,after);assert.equal(a.getConsent(),'denied');});
test('bad configuration and failed storage or tracker never throw into the tool',()=>{
 const a=createAnalytics({measurementId:'bad',send(){throw Error('offline');},load(){throw Error('blocked');},getChoice(){throw Error('denied');},saveChoice(){throw Error('denied');}});
 assert.doesNotThrow(()=>{a.consent(true);a.event('pdf_ready',{});a.consent(false);});
 const b=createAnalytics({measurementId:'G-TEST1234',send(){throw Error('offline');},load(){throw Error('blocked');}});assert.doesNotThrow(()=>{b.consent(true);b.event('pdf_ready',{});});
});
test('privacy and page-view defaults precede Google tag initialization',()=>{
 const {a,sent}=fixture();a.consent(true);
 const setIndex=sent.findIndex(x=>x[0]==='set'),jsIndex=sent.findIndex(x=>x[0]==='js');
 assert.ok(setIndex>=0&&setIndex<jsIndex);
 assert.equal(sent[setIndex][1].send_page_view,false);
 assert.equal(sent[setIndex][1].page_location,'https://example.org/');
 assert.equal(sent[setIndex][1].page_referrer,'https://search.example/');
 assert.equal(sent[setIndex][1].allow_google_signals,false);
});
test('debug probes explicitly tag both page views and task events',()=>{
 const sent=[];const a=createAnalytics({measurementId:'G-TEST1234',debug:true,send:(...args)=>sent.push(args)});a.consent(true);a.event('pdf_ready',{input_source:'sample'});
 assert.ok(sent.filter(x=>x[0]==='event').every(x=>x[2].debug_mode===true));
});
test('toolbox events only accept known tool identifiers',()=>{assert.deepEqual(safeEvent('csv_checked',{tool_id:'csv_check',input_source:'sample',csv:'secret'}),{tool_id:'csv_check',input_source:'sample'});assert.deepEqual(safeEvent('csv_checked',{tool_id:'secret-file'}),{});});

test('page views identify only a bounded tool name',()=>{
 for(const toolId of ['csv_check','home','private-filename']){
 const sent=[];const a=createAnalytics({measurementId:'G-TEST1234',toolId,send:(...x)=>sent.push(x)});a.consent(true);
 const page=sent.find(x=>x[0]==='event'&&x[1]==='page_view')[2];
 assert.equal(page.tool_id,toolId==='private-filename'?undefined:toolId);
 }
});

test('tool choice carries only a bounded target tool',()=>{
 assert.deepEqual(safeEvent('tool_select',{tool_id:'home',target_tool:'csv_check',href:'/csv-check/?q=secret'}),{tool_id:'home',target_tool:'csv_check'});
 assert.deepEqual(safeEvent('tool_select',{tool_id:'home',target_tool:'interleave_pdf',href:'/interleave-pdf/?token=secret'}),{tool_id:'home',target_tool:'interleave_pdf'});
 assert.deepEqual(safeEvent('tool_select',{tool_id:'csv_check',target_tool:'csv_diff',href:'/csv-diff/#private'}),{tool_id:'csv_check',target_tool:'csv_diff'});
 assert.deepEqual(safeEvent('tool_select',{target_tool:'home'}),{});
 assert.deepEqual(safeEvent('tool_select',{target_tool:'secret-tool'}),{});
});

test('interleave_pdf and csv_diff events allow only bounded metadata and strip private payloads',()=>{
 assert.deepEqual(
  safeEvent('interleave_ready',{tool_id:'interleave_pdf',input_source:'file',interface_language:'en',filename:'tax-front.pdf',pages:12,content:'secret'}),
  {tool_id:'interleave_pdf',input_source:'file',interface_language:'en'}
 );
 assert.deepEqual(
  safeEvent('csv_diff_ready',{tool_id:'csv_diff',input_source:'mixed',interface_language:'zh',filename:'payroll.csv',cell_value:'secret-salary',key:'SKU-001'}),
  {tool_id:'csv_diff',input_source:'mixed',interface_language:'zh'}
 );
 for(const toolId of ['interleave_pdf','csv_diff']){
  const sent=[];
  const a=createAnalytics({measurementId:'G-TEST1234',toolId,language:'en',send:(...x)=>sent.push(x)});
  a.consent(true);
  const page=sent.find(x=>x[0]==='event'&&x[1]==='page_view')[2];
  assert.equal(page.tool_id,toolId);
  const readyEvent=toolId==='interleave_pdf'?'interleave_ready':'csv_diff_ready';
  assert.equal(a.event(readyEvent,{tool_id:toolId,input_source:'file',filename:'private-file',secret:'nope'}),true);
  assert.deepEqual(sent.at(-1),['event',readyEvent,{tool_id:toolId,input_source:'file',interface_language:'en'}]);
  assert.ok(!JSON.stringify(sent).includes('private-file'));
  assert.ok(!JSON.stringify(sent).includes('nope'));
 }
});

test('page_location keeps only allowlisted referral utm_source and utm_medium while stripping private query params and hashes',()=>{
 const capture=(location,referrer='')=>{
  const sent=[];
  const a=createAnalytics({measurementId:'G-TEST1234',toolId:'vcf_select',language:'en',location,referrer,send:(...args)=>sent.push(args)});
  a.consent(true);
  const cfg=sent.find(x=>x[0]==='config')[2];
  const set=sent.find(x=>x[0]==='set')[1];
  return {sent,cfg,set};
 };

 const c1=capture('https://nocloudfiles.com/vcf-select/?utm_source=chatgpt.com&secret=alice.vcf#hash','https://chatgpt.com/c/private-thread?utm_source=chatgpt.com');
 assert.equal(c1.cfg.page_location,'https://nocloudfiles.com/vcf-select/?utm_source=chatgpt.com');
 assert.equal(c1.set.page_location,'https://nocloudfiles.com/vcf-select/?utm_source=chatgpt.com');
 assert.equal(c1.cfg.page_referrer,'https://chatgpt.com/');
 assert.ok(!JSON.stringify(c1.sent).includes('alice.vcf'));
 assert.ok(!JSON.stringify(c1.sent).includes('private-thread'));
 assert.ok(!JSON.stringify(c1.sent).includes('#hash'));

 const c2=capture('https://nocloudfiles.com/schedule-to-calendar/?utm_source=Perplexity.ai&utm_medium=referral&utm_content=private_prompt');
 assert.equal(c2.cfg.page_location,'https://nocloudfiles.com/schedule-to-calendar/?utm_source=perplexity.ai&utm_medium=referral');
 assert.equal(c2.set.page_location,'https://nocloudfiles.com/schedule-to-calendar/?utm_source=perplexity.ai&utm_medium=referral');
 assert.ok(!JSON.stringify(c2.sent).includes('private_prompt'));

 const c3=capture('https://nocloudfiles.com/vcf-select/?utm_source=secret_person&utm_medium=private');
 assert.equal(c3.cfg.page_location,'https://nocloudfiles.com/vcf-select/');
 assert.equal(c3.set.page_location,'https://nocloudfiles.com/vcf-select/');
 assert.ok(!JSON.stringify(c3.sent).includes('secret_person'));
 assert.ok(!JSON.stringify(c3.sent).includes('private'));

 const c4=capture('https://nocloudfiles.com/vcf-select/?utm_source=chatgpt.com&utm_medium=secret_campaign');
 assert.equal(c4.cfg.page_location,'https://nocloudfiles.com/vcf-select/?utm_source=chatgpt.com');
 assert.ok(!JSON.stringify(c4.sent).includes('secret_campaign'));

 const c5=capture('https://nocloudfiles.com/vcf-select/?utm_medium=referral&file=contacts.vcf');
 assert.equal(c5.cfg.page_location,'https://nocloudfiles.com/vcf-select/');
 assert.ok(!JSON.stringify(c5.sent).includes('contacts.vcf'));
});

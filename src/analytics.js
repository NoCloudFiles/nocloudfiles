const events=new Set(['tool_select','schedule_ready','contacts_ready','photo_inspected','photo_ready','interleave_ready','csv_check_start','csv_checked','csv_ready','csv_diff_ready','tool_start','photos_added','generate_start','pdf_ready','generate_error','generate_cancel','download_click','feedback_response']);
const tools=['schedule_to_calendar','vcf_select','photo_privacy','interleave_pdf','home','photos_to_pdf','csv_check','csv_diff'];
const values={tool_id:tools,target_tool:tools.filter(t=>t!=='home'),input_source:['sample','file','mixed'],interface_language:['en','zh'],error_code:['input_rejected','decode_failed','too_large','generation_failed'],feedback_result:['helped','unclear','too_large','not_accepted','other']};
const utmSources=new Set(['chatgpt.com','openai','perplexity','perplexity.ai','claude.ai','anthropic','copilot.microsoft.com','copilot','gemini.google.com','gemini','google','bing','github','alternativeto']);
const utmMediums=new Set(['referral','organic','ai','social','web']);
export function safeEvent(name,params={}){
 if(!events.has(name))return null;
 return Object.fromEntries(Object.entries(params).filter(([k,v])=>values[k]?.includes(v)));
}
export function createAnalytics({measurementId='',toolId='',language='en',location='',referrer='',getChoice=()=>null,saveChoice=()=>{},send=()=>{},load=()=>{},disable=()=>{},debug=false}={}){
 const valid=/^G-[A-Z0-9]+$/.test(measurementId);let choice=null,initialized=false,pageSent=false;
 const attempt=fn=>{try{return fn();}catch{return undefined;}};
 const command=(...args)=>attempt(()=>send(...args));
 const clean=(url,originOnly=false)=>{
  try{
   const u=new URL(url);
   if(!/^https?:$/.test(u.protocol))return '';
   if(originOnly)return u.origin+'/';
   const base=u.origin+u.pathname;
   const src=(u.searchParams.get('utm_source')||'').trim().toLowerCase();
   if(!utmSources.has(src))return base;
   const qs=new URLSearchParams({utm_source:src});
   const med=(u.searchParams.get('utm_medium')||'').trim().toLowerCase();
   if(utmMediums.has(med))qs.set('utm_medium',med);
   return `${base}?${qs}`;
  }catch{return '';}
 };
 function start(){
  if(!valid)return;attempt(()=>disable(false));
  if(!initialized){
   initialized=true;
   command('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
   // Set global defaults before initialization: current Google tags may initialize
   // their configured destination without applying a later legacy config command.
   const defaults={send_page_view:false,page_location:clean(location),page_referrer:clean(referrer,true),allow_google_signals:false,allow_ad_personalization_signals:false,...(debug?{debug_mode:true}: {})};
   command('set',defaults);
   command('js',new Date());
   command('config',measurementId,defaults);
   attempt(()=>load(measurementId));
  }else command('consent','update',{analytics_storage:'granted'});
  if(!pageSent){pageSent=true;command('event','page_view',{interface_language:language,...(values.tool_id.includes(toolId)?{tool_id:toolId}:{}),...(debug?{debug_mode:true}: {})});}
 }
 function consent(allowed){
  const next=allowed?'granted':'denied';if(choice===next)return;choice=next;attempt(()=>saveChoice(choice));
  if(allowed)start();else{attempt(()=>disable(true));if(initialized)command('consent','update',{analytics_storage:'denied'});}
 }
 choice=attempt(getChoice)||null;if(choice==='granted')start();
 return {consent,getConsent:()=>choice,event(name,params){if(choice!=='granted'||!valid)return false;const safe=safeEvent(name,{...params,interface_language:language});if(!safe)return false;command('event',name,{...safe,...(debug?{debug_mode:true}: {})});return true;}};
}

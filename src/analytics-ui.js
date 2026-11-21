import {createAnalytics} from './analytics.js';
import {tr,isZh} from './i18n.js';
let analytics;
export function track(name,params){return analytics?.event(name,params);}
export async function setupAnalytics(){
 try{
  const response=await fetch('/analytics-config.json');if(!response.ok)return;
  const {measurementId}=await response.json();if(!/^G-[A-Z0-9]+$/.test(measurementId))return;
  if(!['paper-ready.1986liubo.workers.dev','localhost','127.0.0.1'].includes(location.hostname))return;
  const box=document.createElement('section');box.className='analytics-choice';box.setAttribute('aria-label',tr('可选使用统计','Optional analytics'));
  const text=document.createElement('p');text.textContent=tr('允许可选使用统计，帮助我们了解工具是否有用？Google Analytics 会接收使用事件和正常连接信息，不含照片、文件名或材料内容。拒绝不影响使用。','Allow optional analytics to help us improve this tool? Google Analytics receives usage events and normal connection information, never photos, filenames or document content. Declining does not affect the tool.');
  const yes=document.createElement('button'),no=document.createElement('button');yes.textContent=tr('允许使用统计','Allow analytics');no.textContent=tr('拒绝使用统计','Decline analytics');
  box.append(text,yes,no);document.querySelector('footer').before(box);
  const settings=document.createElement('button');settings.className='text-button';settings.textContent=tr('统计设置','Analytics settings');document.querySelector('.footer-links').append(settings);
  const send=function(){window.dataLayer=window.dataLayer||[];window.dataLayer.push(arguments);};
  analytics=createAnalytics({measurementId,language:isZh?'zh':'en',location:location.href,referrer:document.referrer,
   getChoice:()=>localStorage.getItem('paper-ready-analytics'),saveChoice:v=>localStorage.setItem('paper-ready-analytics',v),send,
   debug:new URLSearchParams(location.search).get('analytics_debug')==='1',
   load:id=>{const script=document.createElement('script');script.async=true;script.src=`https://www.googletagmanager.com/gtag/js?id=${id}`;document.head.append(script);},
   disable:value=>{window[`ga-disable-${measurementId}`]=value;if(value){for(const cookie of document.cookie.split(';')){const name=cookie.split('=')[0].trim();if(/^_ga(?:_|$)/.test(name)){document.cookie=`${name}=; Max-Age=0; Path=/`;document.cookie=`${name}=; Max-Age=0; Path=/; Domain=${location.hostname}`;}}}}
  });
  box.hidden=!!analytics.getConsent();settings.onclick=()=>{box.hidden=false;box.scrollIntoView({block:'nearest'});};
  yes.onclick=()=>{analytics.consent(true);box.hidden=true;};no.onclick=()=>{analytics.consent(false);box.hidden=true;};
 }catch{/* Analytics failure must never interrupt document processing. */}
}

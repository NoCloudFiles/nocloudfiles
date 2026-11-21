export const isZh=typeof document==='undefined'||document.documentElement.lang.startsWith('zh');
export const tr=(zh,en)=>isZh?zh:en;
export const pageCount=n=>tr(`共 ${n} 页`,`${n} ${n===1?'page':'pages'}`);

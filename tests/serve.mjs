// Test-only server: serve the actual built assets with Cloudflare's configured headers.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const headers=Object.fromEntries((await fs.readFile(path.join(root,'_headers'),'utf8')).split('\n').filter(l=>l.startsWith('  ')).map(l=>{const i=l.indexOf(':');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.zip':'application/zip','.tgz':'application/gzip','.png':'image/png','.heic':'image/heic'};
http.createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,'http://localhost');let name=decodeURIComponent(url.pathname);if(name.endsWith('/'))name+='index.html';
  const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||path.basename(file).startsWith('_'))throw Error('not found');
  const data=await fs.readFile(file);res.writeHead(200,{...headers,'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(4178,'127.0.0.1',()=>console.log('Production QA: http://127.0.0.1:4178'));

// NewChanges isolated Cloudflare staging: publish only public marketing files.
// Do not bundle the authenticated admin, dashboard, login, or React app here.
// This preview is read-only, no database or live API access.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const publicRoot=path.resolve('public');
const outDir=path.resolve('cloudflare-output');
const files=[
  'home.html','privacy.html','terms.html','cookies.html','404.html',
  'enterprise.css','enterprise-v3.css','the-fixer-brand.css','portal-polish.css',
  'shell.js','engagement-v1.js',
  'the-fixer-logo.svg','the-fixer-logo-reversed.svg','the-fixer-icon.svg',
  'site.webmanifest'
];
const mime={
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.ico':'image/x-icon',
  '.webmanifest':'application/manifest+json'
};
const site='https://migration.newchanges-app.pages.dev';
const notice='<aside role="status" aria-label="Cloudflare staging notice" style="position:sticky;top:0;z-index:99999;padding:12px 16px;background:#fbedd2;color:#332100;font:600 14px/1.5 system-ui;text-align:center;border-bottom:2px solid #d4a537">Cloudflare staging preview only. Live logins, personal data, finance dashboards, enquiries and database operations remain on Render. Do not enter credentials or personal information here.</aside>';
const assets={};
for(const name of files){
  const full=path.join(publicRoot,name);
  if(!fs.existsSync(full))throw new Error('Required public asset missing: '+name);
  if(!fs.statSync(full).isFile())throw new Error('Expected public file: '+name);
  let bytes=fs.readFileSync(full);
  if(name==='home.html'||name.endsWith('.html')){
    let html=bytes.toString('utf8')
      .replaceAll('{{BASE_URL}}',site)
      .replace(/<meta\s+name=["']robots["']\s+content=["'][^"']*["']\s*\/?>/gi,'')
      .replace(/<link\s+rel=["']canonical["'][^>]*>/gi,'')
      .replace(/<body([^>]*)>/i,'<body$1>'+notice)
      .replace(/<\/head>/i,'<meta name="robots" content="noindex,nofollow,noarchive"></head>');
    bytes=Buffer.from(html);
  }
  const uri=name.endsWith('.html')? (name==='home.html'?'/':name==='404.html'?'/404': '/'+name.replace(/\.html$/,'')) : '/static/'+name;
  const type=mime[path.extname(name)];
  assets[uri]={mime:type,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),gzipBase64:zlib.gzipSync(bytes,{level:9}).toString('base64')};
}
if(!assets['/']||!assets['/static/the-fixer-logo-reversed.svg'])throw new Error('Incomplete public landing preview');
const worker=`// GENERATED: NewChanges isolated read-only Cloudflare public preview.
// Source: public files only. Render main app and databases are unchanged.
const ASSETS=${JSON.stringify(assets)};
const HEADERS={
  'X-Robots-Tag':'noindex, nofollow, noarchive',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Cache-Control':'no-store'
};
function decode(base64){
  const s=atob(base64),out=new Uint8Array(s.length);
  for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);
  return out;
}
function denied(status,message){
  return new Response(JSON.stringify({error:message}),{status,headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8'}});
}
export default {
  async fetch(request){
    const url=new URL(request.url);
    const p=url.pathname;
    if(p==='/api/health'&&['GET','HEAD'].includes(request.method))return new Response(request.method==='HEAD'?null:JSON.stringify({status:'ok',environment:'cloudflare-pages-preview',production:false}),{headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8'}});
    if(p==='/api/migration/capabilities'&&['GET','HEAD'].includes(request.method))return new Response(request.method==='HEAD'?null:JSON.stringify({environment:'cloudflare-pages-preview',auth:'disabled',database:'disconnected',dashboard:'disabled',imports:'disabled',schedulers:'disabled',notifications:'disabled'}),{headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8'}});
    if(p==='/api/migration/readiness'&&['GET','HEAD'].includes(request.method))return new Response(request.method==='HEAD'?null:JSON.stringify({primaryReady:false,status:'BLOCKED',reason:'Authenticated NewChanges API and database connectivity not migrated'}),{headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8'}});
    if(p.startsWith('/api/')||p.startsWith('/auth/')||p==='/api')return denied(404,'This isolated preview does not have live APIs');
    if(!['GET','HEAD'].includes(request.method))return denied(405,'Read-only preview');
    if(p==='/robots.txt')return new Response(request.method==='HEAD'?null:'User-agent: *\\nDisallow: /\\n',{headers:{...HEADERS,'Content-Type':'text/plain; charset=utf-8'}});
    if(p==='/login'||p==='/contact'||p==='/admin'||p==='/dashboard'||p==='/users'||p==='/react'||p.startsWith('/react/')||p==='/set-password')return denied(403,'Live application remains on Render. This public staging page does not accept logins or private data.');
    if(['/favicon.ico','/static/favicon-16.png','/static/favicon-32.png','/static/apple-touch-icon.png'].includes(p))return new Response(null,{status:302,headers:{...HEADERS,Location:'/static/the-fixer-icon.svg'}});
    const asset=ASSETS[p==='/static/site.webmanifest'?'/static/site.webmanifest':p];
    if(!asset)return denied(404,'Not found');
    const bytes=decode(asset.gzipBase64);
    const decompressed=new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(request.method==='HEAD'?null:decompressed,{headers:{...HEADERS,'Content-Type':asset.mime}});
  }
};
`;
fs.mkdirSync(outDir,{recursive:true});
const out=path.join(outDir,'newchanges-isolated-preview.worker.mjs');
fs.writeFileSync(out,worker);
const size=fs.statSync(out).size;
if(size>8*1024*1024)throw new Error('Preview would exceed chosen 8 MiB safety budget');
console.log('Read-only public assets:',Object.keys(assets).length,'Worker bytes:',size,'No private JS or live API bundled');

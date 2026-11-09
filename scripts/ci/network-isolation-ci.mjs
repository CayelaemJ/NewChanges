// Runtime proof: isolated tests must have no outbound IP route and no live credentials.
import assert from 'node:assert/strict';
import net from 'node:net';
const fixture='postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci';
assert.equal(process.env.CI,'true');
assert.equal(process.env.DATABASE_URL,fixture);
assert.equal(process.env.CI_RLS_PROBE_APPROVED,'CI_DISPOSABLE_ONLY');
for(const key of Object.keys(process.env)){
 if(/^(NEON_|RAILWAY_|AIVEN_|RENDER_|CLOUDFLARE_|AWS_SECRET_ACCESS_KEY$|OPENAI_API_KEY$|GROQ_API_KEY$|HF_TOKEN$|MYSQL_PASSWORD$)/i.test(key)){
  throw Error('Prohibited cloud credential environment variable is present: '+key);
 }
}
function canConnect(host,port,timeout=1500){
 return new Promise(resolve=>{
  const socket=new net.Socket();
  let done=false;
  const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value)};
  socket.setTimeout(timeout);
  socket.once('connect',()=>finish(true));
  socket.once('timeout',()=>finish(false));
  socket.once('error',()=>finish(false));
  socket.connect(port,host);
 });
}
assert.equal(await canConnect('127.0.0.1',5432),true,'Disposable PostgreSQL must remain reachable');
const endpoints=[['1.1.1.1',443],['8.8.8.8',53],['169.254.169.254',80]];
for(const [host,port] of endpoints){
 assert.equal(await canConnect(host,port),false,
  'Docker CI has unexpected external network access: '+host+':'+port);
}
console.log('[network-isolation] PASS local PostgreSQL reachable, cloud addresses unreachable, no cloud credentials');

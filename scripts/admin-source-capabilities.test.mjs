import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
function harness(reply){
  const elements=new Map(['btn-sync-now','btn-refresh-now','reset-btn','ingestion-capability','reset-capability','reset-area','reset-confirm','reset-msg'].map(id=>[id,{disabled:true,style:{display:'none'},value:'RESET',focus(){this.focused=true;}}]));
  let requests=0,confirmations=0;
  const context=vm.createContext({API:'',document:{getElementById:id=>elements.get(id)},$ : selector=>elements.get(selector.slice(1)),confirm(){confirmations++;return true;},fetch:async(_url,options)=>{requests++;assert.notEqual(options?.method,'POST','unavailable actions must never write');if(reply instanceof Error)throw reply;return {ok:reply!==null,json:async()=>reply};}});
  vm.runInContext(html.slice(html.indexOf('let SOURCE_INGESTION_ALLOWED'),html.indexOf('function renderIntegSyncStatus')),context);
  for(const [start,end] of [['async function openReset(){','async function doReset(){'],['async function doReset(){','async function boot(){'],['async function syncNow(){','async function refreshNow(btn){'],['async function refreshNow(btn){','function syncLogFailureDetail(']]){
    vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end)),context);
  }
  return {elements,context,counts:()=>({requests,confirmations})};
}
for(const reply of [{sourceIngestionAllowed:false},{},null,new Error('offline')]){
  test(`unavailable source actions stop before confirmation, settings save and reset (${JSON.stringify(reply)})`,async()=>{
    const h=harness(reply);
    for(const action of ['openReset()','doReset()','syncNow()','refreshNow()'])await vm.runInContext(action,h.context);
    assert.deepEqual(h.counts(),{requests:4,confirmations:0});
    for(const id of ['btn-sync-now','btn-refresh-now','reset-btn'])assert.equal(h.elements.get(id).disabled,true);
    assert.equal(h.elements.get('reset-area').style.display,'none');
    assert.equal(h.elements.get('reset-confirm').value,'');
    assert.match(h.elements.get('reset-capability').textContent,/standby|could not be verified/);
  });
}
test('leader capability opens confirmation and revocation closes it',async()=>{
  const h=harness({sourceIngestionAllowed:true});
  await vm.runInContext('openReset()',h.context);
  assert.equal(h.elements.get('reset-area').style.display,'block');
  assert.equal(h.elements.get('reset-confirm').focused,true);
  assert.equal(h.elements.get('reset-btn').disabled,false);
  vm.runInContext('renderIngestionCapability({sourceIngestionAllowed:false})',h.context);
  assert.equal(h.elements.get('reset-area').style.display,'none');
  assert.equal(h.elements.get('reset-btn').disabled,true);
});
test('source writing controls are disabled in the initial HTML',()=>{
  for(const id of ['btn-sync-now','btn-refresh-now','reset-btn'])assert.match(html,new RegExp(`<button[^>]*id="${id}"[^>]*disabled`));
});

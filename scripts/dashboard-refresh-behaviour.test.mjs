import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../public/dashboard.html',import.meta.url),'utf8');
const poll=html.slice(html.indexOf('let __SOURCE_VERSION__ = null;'),html.indexOf('setInterval(checkSourceVersion,30000);'));
const loader=html.slice(html.indexOf('async function loadLiveData('),html.indexOf('async function fetchPortfolioInBackground('));
const server=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
const fenceStart=server.indexOf('app.addHook("onSend"',server.indexOf('// A source import may start'));
const fence=server.slice(fenceStart,server.indexOf('function dashboardUsesPublishedSnapshot(',fenceStart));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('failed refresh retries the same publication; focus events do not overlap polls',async()=>{
  const gate=deferred();let polls=0,loads=0;
  const context=vm.createContext({window:{__LIVE__:true},document:{visibilityState:'visible'},AbortSignal,
    renderRefreshStatus(){},fetch:async()=>{polls++;await gate.promise;return {ok:true,json:async()=>({version:'v2'})};},
    loadLiveData:async()=>{loads++;}});
  vm.runInContext(poll,context);
  const first=vm.runInContext('checkSourceVersion()',context);
  await vm.runInContext('checkSourceVersion()',context);
  assert.equal(polls,1);
  gate.resolve();await first;
  assert.equal(vm.runInContext('__SOURCE_VERSION__',context),null);
  await vm.runInContext('checkSourceVersion()',context);
  assert.equal(loads,2);
  vm.runInContext("__SOURCE_VERSION__='v2'",context);
  await vm.runInContext('checkSourceVersion()',context);
  assert.equal(loads,2);
});

function loaderContext(fetch){
  const label={textContent:''};let destructiveErrors=0,clears=0;
  const view={setAttribute(){},removeAttribute(){clears++;},classList:{add(){},remove(){}}};
  const context=vm.createContext({LIVE_REQUEST_SEQ:0,window:{__ME__:{},__LIVE__:true},AbortSignal,
    document:{getElementById:id=>id==='employer-view'?view:id==='data-fresh-label'?label:null,querySelector:()=>({classList:{add(){}}})},
    location:{search:''},URLSearchParams,API_BASE:'',fetch,
    employerIdFromUrl:()=> 'employer',syncStateFromUrl(){},periodFromUrl(){},quarterFromUrl(){},apiFilterQuery:()=>'',
    populateMonthSelect:async()=>{},showLiveError(){destructiveErrors++;},wireAudience(){},wireHeaderBtns(){}});
  vm.runInContext(loader,context);
  return {context,label,errors:()=>destructiveErrors,clears:()=>clears};
}

test('refresh failure preserves loaded dashboard and exposes failure status',async()=>{
  const state=loaderContext(async()=>{throw new Error('source unavailable');});
  await vm.runInContext('loadLiveData({refreshOnly:true})',state.context);
  assert.equal(state.errors(),0);
  assert.match(state.label.textContent,/Update failed/);
});

test('an obsolete failed response cannot replace newer data or clear its busy state',async()=>{
  const gate=deferred();const state=loaderContext(()=>gate.promise);
  const pending=vm.runInContext('loadLiveData({refreshOnly:true})',state.context);
  vm.runInContext('LIVE_REQUEST_SEQ++',state.context);
  gate.reject(new Error('old request failed'));await pending;
  assert.equal(state.label.textContent,'');
  assert.equal(state.errors(),0);
  assert.equal(state.clears(),0);
});

test('the response hook rejects reads crossing an import or publication change',async()=>{
  for(const current of [
    {lastSuccessfulSyncAt:'v1',lastSyncStatus:'PROCESSING'},
    {lastSuccessfulSyncAt:'v1',lastSyncStatus:'FAILED'},
    {lastSuccessfulSyncAt:'v2',lastSyncStatus:'OK'},
  ]){
    let hook;
    vm.runInNewContext(fence,{app:{addHook(_event,handler){hook=handler;}},
      dashboardSyncState:async()=>current,
      dashboardUsesPublishedSnapshot:state=>state.lastSyncStatus!=='OK'});
    const reply={statusCode:200,code(n){this.statusCode=n;return this;},header(){return this;}};
    const result=await hook({method:'GET',url:'/api/employers/fixture/dashboard'},reply,
      JSON.stringify({syncStatus:{lastSuccessfulSyncAt:'v1',lastSyncStatus:'OK'},headcount:123}));
    assert.equal(reply.statusCode,503);
    assert.equal(JSON.parse(result).headcount,undefined);
  }
});

test('the response hook serves stable data and does not re-read immutable fallbacks',async()=>{
  let hook,reads=0;
  vm.runInNewContext(fence,{app:{addHook(_event,handler){hook=handler;}},
    dashboardSyncState:async()=>{reads++;return {lastSuccessfulSyncAt:'v1',lastSyncStatus:'OK'};},
    dashboardUsesPublishedSnapshot:()=>false});
  for(const fallback of [false,true]){
    const reply={statusCode:200};
    const payload=JSON.stringify({syncStatus:{lastSuccessfulSyncAt:'v1',lastSyncStatus:'OK',servingLastSuccessful:fallback},headcount:123});
    assert.equal(await hook({method:'GET',url:'/api/portfolio'},reply,payload),payload);
    assert.equal(reply.statusCode,200);
  }
  assert.equal(reads,1);
});

test('historical array responses are also fenced against a concurrent import',async()=>{
  let hook;const req={method:'GET',url:'/api/employers/fixture/score-history'};
  const starts=new WeakMap([[req,{lastSuccessfulSyncAt:'v1',lastSyncStatus:'OK'}]]);
  vm.runInNewContext(fence,{app:{addHook(_event,handler){hook=handler;}},dashboardReadVersions:starts,
    dashboardSyncState:async()=>({lastSuccessfulSyncAt:'v1',lastSyncStatus:'PROCESSING'}),
    dashboardUsesPublishedSnapshot:state=>state.lastSyncStatus!=='OK'});
  const reply={statusCode:200,code(n){this.statusCode=n;return this;},header(){return this;}};
  await hook(req,reply,JSON.stringify([{period:'2026-10',optimiseScore:50}]));
  assert.equal(reply.statusCode,503);
});

test('publication events cannot supersede the initial authenticated page setup',async()=>{
  let polls=0;
  const context=vm.createContext({window:{__LIVE__:false},document:{visibilityState:'visible'},
    fetch:async()=>{polls++;}});
  vm.runInContext(poll,context);
  await vm.runInContext('checkSourceVersion()',context);
  assert.equal(polls,0);
});

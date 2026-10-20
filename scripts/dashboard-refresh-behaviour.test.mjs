import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../public/dashboard.html',import.meta.url),'utf8');
const poll=html.slice(html.indexOf('let __SOURCE_VERSION__ = null;'),html.indexOf('setInterval(checkSourceVersion,30000);'));
const loader=html.slice(html.indexOf('async function loadLiveData('),html.indexOf('async function fetchPortfolioInBackground('));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('failed refresh retries the same publication; focus events do not overlap polls',async()=>{
  const gate=deferred();let polls=0,loads=0;
  const context=vm.createContext({document:{visibilityState:'visible'},AbortSignal,
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

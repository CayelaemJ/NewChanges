import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>{
  const model=()=>({upsert:vi.fn(),update:vi.fn(async()=>({})),create:vi.fn(async()=>({id:'synthetic-batch'})),findUnique:vi.fn(async()=>null),findFirst:vi.fn(async()=>null)});
  return {bad:false,empty:false,extraPage:false,feeds:[],closed:[],db:{integrationConfig:model(),integrationCursor:model(),syncLog:model(),importBatch:model(),analyticsRoute:model()},commit:vi.fn(async()=>({inserted:1,updated:0,deleted:0,skipped:0,historyRows:0})),snapshot:vi.fn(async()=>({persisted:false})),alert:vi.fn()};
});
vi.mock('@prisma/client',()=>({PrismaClient:class{constructor(){return state.db;}},Prisma:{DbNull:null}}));
vi.mock('pg',()=>({Client:class{async connect(){} async query(){return {rows:[{acquired:true}]};}async end(){}}}));
vi.mock('../src/services/snapshotBuilder.js',()=>({snapshotEmployer:state.snapshot}));
vi.mock('../src/services/automationService.js',()=>({notifyAdmins:vi.fn(async()=>({emailed:0})),notifyScoreChangeIfCurrentPeriod:vi.fn(async()=>{})}));
vi.mock('../src/services/importService.js',()=>({commitSyncRows:state.commit,commitBatch:vi.fn(),SYNC_BULK_CHUNK_SIZE:1000}));
vi.mock('../src/services/dataQualityService.js',()=>({assessIncomingRows:vi.fn(async()=>({status:'PASS',findings:[]}))}));
vi.mock('../src/services/mlopsService.js',()=>({runMLOpsAssessment:vi.fn(async()=>{})}));
vi.mock('../src/services/operationalFailureService.js',()=>({recoverInterruptedSyncs:vi.fn(async()=>{}),reportOperationalFailure:state.alert}));
vi.mock('../src/services/sourceAdapter.js',async()=>{
  const {getFormat}=await import('../src/services/reportFormats.js');
  return {configuredSourceMode:()=> 'SQL',sourceIsConfigured:()=>true,effectiveSourceConfig:x=>x,sourceEnvironmentLocked:()=>false,
    createSourceAdapter:async()=>({mode:'SQL',label:'synthetic',fetchReport:()=>{throw Error('Unbounded fetch must not run');},close:async()=>{},
      async *iterateReportPages(key){
        state.feeds.push(key);
        try{
          if(state.empty)return;
          const record=Object.fromEntries(getFormat(key).fields.map(f=>[f.name,f.example]));
          yield {records:[record],location:'synthetic'};
          if(state.extraPage && key==='employers')yield {records:[{...record,employer_ref:'SECOND'}],location:'synthetic'};
          if(state.bad && key==='employees')yield {records:[{...record,payroll_ref:null}],location:'synthetic'};
        }finally{state.closed.push(key);}
      },
    })};
});
import {runSync,pendingDashboardRetryDue} from '../src/services/syncService.js';
import {LOAD_ORDER} from '../src/services/reportFormats.js';
beforeEach(()=>{
  vi.clearAllMocks();state.bad=false;state.empty=false;state.extraPage=false;state.feeds=[];state.closed=[];
  process.env.DATABASE_URL='postgresql://synthetic.invalid/testing';
  delete process.env.ENABLE_SEMANTIC_SHADOW_ENQUEUE;
  delete process.env.STANDBY_MODE;
  state.snapshot.mockResolvedValue({persisted:false});
  state.db.syncLog.findFirst.mockResolvedValue(null);
  state.db.integrationConfig.upsert.mockResolvedValue({sourceMode:'SQL'});
  state.db.integrationCursor.upsert.mockImplementation(async args=>({reportKey:args.where.reportKey,lastSourceUpdatedAt:state.empty?new Date('2026-10-01'):null,lastSuccessAt:state.empty?new Date('2026-10-01'):null}));
});
describe('bounded sync orchestration',()=>{
  it('backs off durable dashboard retries and stops automatic retries after five attempts',async()=>{
    const now=Date.now(),config={lastSyncStatus:'PARTIAL',lastSyncAt:new Date(now)};
    state.db.syncLog.findFirst.mockResolvedValue({summary:{pendingSnapshotEmployerIds:['fixture'],snapshotRetryAttempt:2}});
    expect(await pendingDashboardRetryDue(config,now+59999)).toBe(false);
    expect(await pendingDashboardRetryDue(config,now+60000)).toBe(true);
    state.db.syncLog.findFirst.mockResolvedValue({summary:{pendingSnapshotEmployerIds:['fixture'],snapshotRetryAttempt:5}});
    expect(await pendingDashboardRetryDue(config,now+3600000)).toBe(false);
  });
  it('blocks direct service calls on standby before any database or source action',async()=>{
    process.env.STANDBY_MODE='true';
    try {
      for(const trigger of ['manual','scheduled','full-refresh']) {
        const result=await runSync(trigger);expect(result.status).toBe('STANDBY');
      }
      expect(state.db.integrationConfig.upsert).not.toHaveBeenCalled();
      expect(state.commit).not.toHaveBeenCalled();expect(state.feeds).toEqual([]);
    } finally {delete process.env.STANDBY_MODE;}
  });
  it('does not publish sync success while dashboard recalculation is pending',async()=>{
    let release;const gate=new Promise(resolve=>{release=resolve;});
    state.snapshot.mockImplementationOnce(async()=>{await gate;return {persisted:false};});
    const pending=runSync('manual');
    await vi.waitFor(()=>expect(state.snapshot).toHaveBeenCalled());
    expect(state.db.integrationConfig.update.mock.calls.some(([a])=>a.data.lastSuccessfulSyncAt)).toBe(false);
    release();const result=await pending;expect(result.status).toBe('OK');
    expect(state.db.integrationConfig.update.mock.calls.some(([a])=>a.data.lastSuccessfulSyncAt)).toBe(true);
  });
  it('replays persisted snapshot debt even when a new sync has no changed employers',async()=>{
    state.empty=true;
    state.db.syncLog.findFirst.mockResolvedValue({summary:{pendingSnapshotEmployerIds:['previous-employer']}});
    const result=await runSync('manual');expect(result.ok).toBe(true);
    expect(state.snapshot).toHaveBeenCalledWith('previous-employer');
    const completed=state.db.syncLog.update.mock.calls.find(([a])=>a.data.status==='OK');
    expect(completed[0].data.summary.pendingSnapshotEmployerIds).toEqual([]);
  });
  it('retains the published version when recalculation fails and emits an operational alert',async()=>{
    state.snapshot.mockRejectedValueOnce(Error('synthetic snapshot failure'));
    const result=await runSync('manual');expect(result.ok).toBe(false);
    expect(state.db.integrationConfig.update.mock.calls.some(([a])=>a.data.lastSuccessfulSyncAt)).toBe(false);
    expect(state.alert).toHaveBeenCalledWith('DASHBOARD_REFRESH');
  });

  it('consumes all ten feeds in order and advances checkpoints only after commit',async()=>{
    const result=await runSync('manual');
    expect(result.status).toBe('OK');expect(state.feeds).toEqual(LOAD_ORDER);expect(state.closed).toEqual(LOAD_ORDER);
    expect(state.commit).toHaveBeenCalledTimes(10);
    const checkpoints=state.db.integrationCursor.update.mock.calls.filter(([args])=>args.data.lastSourceUpdatedAt);
    expect(checkpoints).toHaveLength(10);
    expect(state.commit.mock.invocationCallOrder[0]).toBeLessThan(state.db.integrationCursor.update.mock.invocationCallOrder[0]);
  });
  it('retains the feed checkpoint after a later commit fails and marks its audit failed',async()=>{
    state.extraPage=true;
    state.commit.mockResolvedValueOnce({inserted:1,updated:0,deleted:0,skipped:0,historyRows:0})
      .mockRejectedValueOnce(Error('synthetic database write failure'));
    const result=await runSync('manual');
    expect(result.status).toBe('FAILED');expect(state.feeds).toEqual(['employers']);
    expect(state.db.integrationCursor.update.mock.calls.every(([a])=>!a.data.lastSourceUpdatedAt)).toBe(true);
    expect(state.db.importBatch.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'FAILED'})}));
    expect(result.summary.workforce_snapshots.status).toBe('BLOCKED');
  });
  it('rejects a late invalid row before writing that feed, retains its cursor and blocks dependencies',async()=>{
    state.bad=true;const result=await runSync('manual');
    expect(result.status).toBe('PARTIAL');expect(state.feeds).toEqual(LOAD_ORDER.slice(0,3));
    expect(state.commit).toHaveBeenCalledTimes(2);expect(state.closed).toEqual(LOAD_ORDER.slice(0,3));
    const employeeUpdates=state.db.integrationCursor.update.mock.calls.filter(([a])=>a.where.reportKey==='employees');
    expect(employeeUpdates.every(([a])=>a.data.lastSourceUpdatedAt===undefined)).toBe(true);
    expect(employeeUpdates.at(-1)[0].data.lastStatus).toBe('FAILED');
    expect(result.summary.platform_users.status).toBe('BLOCKED');expect(state.alert).toHaveBeenCalledWith('SOURCE_SYNC');
  });
});

import {afterEach,describe,it,expect,vi} from 'vitest';
import {publishedCohortMatches} from '../src/services/publishedCohort.ts';
import {createPublicationCache} from '../src/services/publicationCache.ts';
import {createDashboardPublicationStream} from '../src/services/dashboardPublicationStream.ts';
afterEach(()=>vi.useRealTimers());
describe('publication cache fencing',()=>{
  it('rejects in-flight stale writes and isolates user-specific payload mutations',()=>{
    const cache=createPublicationCache(2), old=cache.generation();
    cache.set('x',{chat:{available:true}},Date.now()+10000,old);
    const response=cache.get('x');response.chat.available=false;
    expect(cache.get('x').chat.available).toBe(true);
    cache.clear();
    expect(cache.set('x',{old:true},Date.now()+10000,old)).toBe(false);
    expect(cache.get('x')).toBeUndefined();
  });
  it('invalidates an employer and fences its outstanding read',()=>{
    const cache=createPublicationCache(),generation=cache.generation();
    const key=JSON.stringify(['schema','employer','2026-10']);
    cache.set(key,1,Date.now()+10000,generation);
    cache.invalidateEmployer('employer');
    expect(cache.get(key)).toBeUndefined();
    expect(cache.set(key,2,Date.now()+10000,generation)).toBe(false);
  });
  it('enforces the entry budget even when no entries have expired',()=>{
    const cache=createPublicationCache(1), generation=cache.generation();
    cache.set('a',1,Date.now()+10000,generation);cache.set('b',2,Date.now()+10000,generation);
    expect(cache.get('a')).toBeUndefined();expect(cache.get('b')).toBe(2);
  });
});
describe('cross-instance publication observer',()=>{
  it('shares reads, retries failures, emits new versions, and stops without browsers',async()=>{
    vi.useFakeTimers();let version='v1';
    const read=vi.fn(async()=>version), a=vi.fn(),b=vi.fn();
    const stream=createDashboardPublicationStream(read);
    const stopA=stream.subscribe(a),stopB=stream.subscribe(b);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);expect(a).toHaveBeenCalledWith('v1');
    expect(b).toHaveBeenCalledWith('v1');
    read.mockRejectedValueOnce(Error('offline'));version='v2';
    await vi.advanceTimersByTimeAsync(5000);expect(a).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);expect(a).toHaveBeenLastCalledWith('v2');
    stopA();stopB();const count=read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);expect(read).toHaveBeenCalledTimes(count);
  });
});

describe('published fallback cohorts',()=>{
  const payload={filterContext:{period:'2026-10',range:'month',site:null,income:null}};
  it('retains a matching immutable latest/month dashboard',()=>{
    expect(publishedCohortMatches(payload,{range:'latest'})).toBe(true);
    expect(publishedCohortMatches(payload,{period:'2026-10'})).toBe(true);
  });
  it('does not substitute latest/unfiltered data for a different selection',()=>{
    for(const query of [{period:'2026-09'},{site:'Cape Town'},{income:'LOW'},{range:'all'},{quarter:'2026-Q4'}])
      expect(publishedCohortMatches(payload,query)).toBe(false);
  });
});

// Small per-process cache for costly read-only dimension lookups.
// TTL bounds staleness across Railway/Render; explicit invalidation handles
// known local refreshes. Never cache authorization or user permission results.
export function createBoundedDimensionCache<T>(ttlMs:number,maxEntries:number){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>300_000||
    !Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>1000)
  throw new Error("Invalid dimension cache limits");
 const cache=new Map<string,{expiresAt:number;value:Promise<T>}>();
 function removeExpired(now:number){
  for(const [key,entry] of cache)if(entry.expiresAt<=now)cache.delete(key);
 }
 return {
  async get(key:string,load:()=>Promise<T>):Promise<T>{
   const now=Date.now();
   const existing=cache.get(key);
   if(existing&&existing.expiresAt>now)return existing.value;
   if(existing)cache.delete(key);
   removeExpired(now);
   while(cache.size>=maxEntries)cache.delete(cache.keys().next().value!);
   const pending=Promise.resolve().then(load);
   const entry={expiresAt:now+ttlMs,value:pending};
   cache.set(key,entry);
   try{return await pending;}
   catch(error){if(cache.get(key)===entry)cache.delete(key);throw error;}
  },
  invalidate(key:string){cache.delete(key);},
  clear(){cache.clear();},
  size(){return cache.size;},
 };
}

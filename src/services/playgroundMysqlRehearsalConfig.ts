// Explicitly gated, small-cost operator rehearsal configuration. No network I/O.
import {LOAD_ORDER} from "./reportFormats.js";
import type {CanonicalSchemaMapping} from "./canonicalSchemaMapping.js";
import type {PlaygroundMappedMysqlRehearsal} from "./playgroundMappedImportRehearsal.js";
function numeric(env:NodeJS.ProcessEnv,key:string,fallback:number,max:number){
 const raw=env[key];
 if(raw!==undefined&&!/^[1-9][0-9]*$/.test(raw))throw new Error("Invalid Playground numeric limit: "+key);
 const n=raw===undefined?fallback:Number(raw);
 if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error("Playground limit exceeded: "+key);
 return n;
}
export function guardedMappedMysqlRehearsal(
 env:NodeJS.ProcessEnv,mapping:CanonicalSchemaMapping,
):PlaygroundMappedMysqlRehearsal{
 if(env.PLAYGROUND_MAPPED_SOURCE_APPROVED!=="yes")
  throw new Error("Explicit Playground mapped-source approval required");
 if(!["Testing","Playground and new ideas"].includes(env.RAILWAY_ENVIRONMENT_NAME??""))
  throw new Error("Mapped source rehearsal restricted to Railway Testing or Playground");
 const stagingRoot=env.PLAYGROUND_STAGING_ROOT??"/tmp/newchanges-playground-mapped";
 if(!stagingRoot.startsWith("/tmp/newchanges-playground-")||stagingRoot.includes(".."))
  throw new Error("Isolated Playground staging directory required");
 const upperWatermark=env.PLAYGROUND_SOURCE_WATERMARK??"";
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(upperWatermark)||
    !Number.isFinite(Date.parse(upperWatermark)))
  throw new Error("Explicit source UTC watermark required");
 const pageSize=numeric(env,"PLAYGROUND_PAGE_SIZE",100,250);
 const maxRowsPerFeed=numeric(env,"PLAYGROUND_ROWS_PER_FEED",1000,10000);
 const maxBytesPerFeed=numeric(env,"PLAYGROUND_BYTES_PER_FEED",2*1024*1024,8*1024*1024);
 const maxPagesPerFeed=numeric(env,"PLAYGROUND_PAGES_PER_FEED",20,100);
 const maxTotalRows=LOAD_ORDER.length*maxRowsPerFeed;
 const maxTotalBytes=LOAD_ORDER.length*maxBytesPerFeed;
 const maxTotalPages=LOAD_ORDER.length*maxPagesPerFeed;
 if(maxTotalBytes>64*1024*1024)throw new Error("Playground aggregate data budget exceeds 64 MiB");
 const config={approvedForPlayground:true as const,mapping,stagingRoot,upperWatermark,
  source:{host:env.PLAYGROUND_MYSQL_HOST??"",port:numeric(env,"PLAYGROUND_MYSQL_PORT",3306,65535),
   database:env.PLAYGROUND_MYSQL_DATABASE??"",user:env.PLAYGROUND_MYSQL_USER??"",
   password:env.PLAYGROUND_MYSQL_PASSWORD??"",ssl:true as const,rejectUnauthorized:true as const},
  pageSize,maxRowsPerFeed,maxBytesPerFeed,maxPagesPerFeed,
  maxTotalRows,maxTotalBytes,maxTotalPages};
 if(!config.source.host||!config.source.database||!config.source.user||
  !config.source.password||config.source.user.toLowerCase()==="root")
  throw new Error("Restricted read-only Playground MySQL connection required");
 return config;
}

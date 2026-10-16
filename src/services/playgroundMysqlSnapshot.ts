// Explicit, opt-in MySQL mapped source snapshot reader for Playground.
// Not wired to the live sync path. Requires restricted credentials and TLS.
// Bounded lifespan prevents long snapshot transactions on large source DBs.
import {randomBytes} from "node:crypto";
import type {MappedSqlReader} from "./canonicalMappedStagingRunner.js";
import {buildSourceMetadataQuery,validateDiscoveredCatalog,type DiscoveryColumn} from "./canonicalSchemaDiscovery.js";

export interface PlaygroundMysqlSource {
 host:string;port?:number;database:string;user:string;password:string;
 ssl:true;rejectUnauthorized:true;queryTimeoutMs?:number;
}
export interface PlaygroundMysqlSnapshot extends MappedSqlReader {
 discoverColumns(schema:string,maxColumns?:number):Promise<DiscoveryColumn[]>;
 close():Promise<void>;
}
export async function openPlaygroundMysqlSnapshot(config:PlaygroundMysqlSource):Promise<PlaygroundMysqlSnapshot>{
 if(!config.host||!config.database||!config.user||config.user.trim().toLowerCase()==="root"||!config.password||
   config.ssl!==true||config.rejectUnauthorized!==true||
   !/^[a-zA-Z0-9_.-]{1,253}$/.test(config.host)||
   !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.database))
    throw new Error("Playground MySQL snapshot requires explicit TLS and valid restricted credentials");
 const port=config.port??3306;
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error("Invalid MySQL source port");
 const timeout=config.queryTimeoutMs??15_000;
 if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>30_000)
  throw new Error("Invalid MySQL query timeout");
 const mysql:any=await import("mysql2/promise");
 const create=mysql.createConnection??mysql.default?.createConnection;
 const connection=await create({host:config.host,port,database:config.database,
  user:config.user,password:config.password,ssl:{rejectUnauthorized:true},
  connectTimeout:timeout,timezone:"Z",dateStrings:false});
 const snapshotId="mysql_"+randomBytes(16).toString("hex");
 const openedAt=Date.now();
 let closed=false;
 try{
  await connection.query({sql:"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",timeout});
  await connection.query({sql:"START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",timeout});
 }catch(e){await connection.end().catch(()=>{});throw e;}
 return {
  snapshotId,snapshotConsistent:true,
  async discoverColumns(schema,maxColumns=5000){
   if(closed||Date.now()-openedAt>120_000)throw new Error("MySQL source snapshot expired");
   const query=buildSourceMetadataQuery("MYSQL",schema,maxColumns);
   const [raw]=await connection.query({sql:query.sql,timeout},[...query.params]);
   if(!Array.isArray(raw))throw new Error("Invalid source metadata response");
   const rows:DiscoveryColumn[]=raw.map((r:any)=>({schema:String(r.table_schema),table:String(r.table_name),
    column:String(r.column_name),dataType:String(r.data_type),nullable:r.is_nullable==="YES"}));
   const result=validateDiscoveredCatalog(rows,schema,maxColumns);
   if(!result.complete)throw new Error("Incomplete source metadata: "+result.issues.join("; "));
   return rows;
  },
  async queryReadOnly(sql,params){
   if(closed||Date.now()-openedAt>120_000)throw new Error("MySQL source snapshot expired; restart the isolated rehearsal");
   if(!/^SELECT\s/i.test(sql)||/[;]|--|\/\*/.test(sql))
    throw new Error("Only one compiled read-only SELECT is permitted");
   const pageSize=params[params.length-1];
   if(!Number.isSafeInteger(pageSize)||Number(pageSize)<1||Number(pageSize)>1000)
    throw new Error("Invalid mapped MySQL page limit");
   const [rows]=await connection.query({sql,timeout},[...params]);
   if(!Array.isArray(rows)||rows.length>Number(pageSize))
    throw new Error("MySQL source exceeded mapped query row limit");
   const size=Buffer.byteLength(JSON.stringify(rows),"utf8");
   if(size>2*1024*1024)throw new Error("MySQL source page exceeded 2 MiB staging limit");
   return rows as Record<string,unknown>[];
  },
  async close(){
   if(closed)return;
   closed=true;
   try{await connection.query({sql:"ROLLBACK",timeout});}
   finally{await connection.end();}
  }
 };
}

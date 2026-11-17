/**
 * Bounded MySQL-native chart pool. Never stores rows, aggregates, CDC cursors,
 * or feed metadata in the application PostgreSQL database.
 *
 * Single immutable source configuration per process: credential/source changes
 * require process restart, preventing accidental cross-source pool reuse.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type CdcMysqlConnector, type CdcMysqlQueryConnection,
  type CdcMysqlReaderSettings, validateSettings,
} from "./ingestStageCdcMysqlReader.js";

export interface ChartPoolConnection {
  query(command: string | {sql:string;timeout:number}, params?: unknown[]): Promise<[unknown,unknown]>;
  release(): void;
  destroy(): void;
}
export interface ChartPool {
  getConnection(): Promise<ChartPoolConnection>;
}
export interface ChartPoolOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectTimeout: number;
  multipleStatements: false;
  timezone: "Z";
  ssl: {ca:string;rejectUnauthorized:true;verifyIdentity:true};
  connectionLimit: number;
  waitForConnections: false;
  maxIdle: number;
  idleTimeout: number;
  enableKeepAlive: true;
}
export type ChartPoolFactory = (options: ChartPoolOptions) => ChartPool;

const MAX_CONNECTIONS = 4;
const IDLE_MS = 30_000;

function configFingerprint(settings: CdcMysqlReaderSettings): string {
  const values = [settings.sourceId,settings.hostname,settings.port,settings.username,
    settings.password,settings.caCertificatePath,settings.queryTimeoutMs];
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export function createMysqlChartPoolConnector(
  factory: ChartPoolFactory,
  caLoader: (path:string)=>Promise<string> = (path)=>readFile(path,"utf8"),
): CdcMysqlConnector {
  let identity: string | null = null;
  let pending: Promise<ChartPool> | null = null;
  return async (settings): Promise<CdcMysqlQueryConnection> => {
    validateSettings(settings);
    const fingerprint = configFingerprint(settings);
    if (identity !== null && identity !== fingerprint)
      throw new Error("CDC_MYSQL_POOL_CONFIG_CHANGED_RESTART_REQUIRED");
    // Reserve identity synchronously before awaiting CA loading. Concurrent
    // first requests cannot initialize pools with different source credentials.
    if (identity === null) identity = fingerprint;
    if (!pending) {
      pending = (async () => {
        const ca = await caLoader(settings.caCertificatePath);
        if (!ca.includes("BEGIN CERTIFICATE"))
          throw new Error("CDC_MYSQL_CA_INVALID");
        return factory({
          host:settings.hostname,port:settings.port,user:settings.username,
          password:settings.password,database:"ingest_stage",
          connectTimeout:Math.min(settings.queryTimeoutMs,10_000),
          multipleStatements:false,timezone:"Z",
          ssl:{ca,rejectUnauthorized:true,verifyIdentity:true},
          connectionLimit:MAX_CONNECTIONS,waitForConnections:false,
          maxIdle:2,idleTimeout:IDLE_MS,enableKeepAlive:true,
        });
      })();
    }
    let conn: ChartPoolConnection;
    try {
      const pool=await pending;
      conn=await pool.getConnection();
    } catch {
      // Redact private driver messages, even on pool acquisition errors.
      throw new Error("CDC_MYSQL_POOL_CONNECTION_UNAVAILABLE");
    }
    let closed=false;
    let safeToRelease=false;
    let destroyed=false;
    const destroy=()=>{
      if (destroyed) return;
      destroyed=true;
      try {conn.destroy();} catch { /* redacted */ }
    };
    return {
      async query(command,params=[]) {
        if (closed) throw new Error("CDC_MYSQL_POOL_LEASE_CLOSED");
        const sql=typeof command==="string"?command:command.sql;
        try {
          const result=await conn.query(command,params);
          // The read service issues ROLLBACK before publishing success.
          // Any failure or unexpected checkout leaves the lease unusable.
          safeToRelease=sql==="ROLLBACK";
          return result;
        } catch {
          safeToRelease=false;
          closed=true;
          destroy();
          throw new Error("CDC_MYSQL_POOL_QUERY_FAILED");
        }
      },
      async end() {
        if (closed) return;
        closed=true;
        if (!safeToRelease) {destroy(); return;}
        try {conn.release();}
        catch {destroy();throw new Error("CDC_MYSQL_POOL_RELEASE_FAILED");}
      },
    };
  };
}

// Lazily imported in a wrapper to avoid loading the driver for disabled routes.
let mysqlPoolFactory: ChartPoolFactory | null = null;
const primaryConnector = createMysqlChartPoolConnector((options)=>{
  if (!mysqlPoolFactory) throw new Error("CDC_MYSQL_POOL_DRIVER_NOT_INITIALIZED");
  return mysqlPoolFactory(options);
});
export const acquirePooledMysqlChart: CdcMysqlConnector = async (settings)=>{
  validateSettings(settings);
  if (!mysqlPoolFactory) {
    const mysql=await import("mysql2/promise");
    mysqlPoolFactory=(options)=>mysql.createPool(options) as unknown as ChartPool;
  }
  return primaryConnector(settings);
};

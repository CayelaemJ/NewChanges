/**
 * Metadata-only physical source lineage discovery for all ten canonical
 * reporting views. No business rows, writes, binlog consumption or secrets
 * are returned. Discovery is NOT approval for CDC: transforms, triggers,
 * routines and tenant attribution require separate human review.
 */
import { effectiveSourceConfig, type IntegrationSourceConfig } from "./sourceAdapter.js";
import { directReportingEnabled } from "./directMysqlReporting.js";
import { LOAD_ORDER } from "./reportFormats.js";

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_OBJECTS = 500;
interface ObjectType { TABLE_NAME: string; TABLE_TYPE: string }
interface Usage {
  VIEW_SCHEMA: string; VIEW_NAME: string; TABLE_SCHEMA: string; TABLE_NAME: string;
}
export interface SourceCdcLineage {
  feed: string;
  view: string;
  physicalTables: string[];
  unresolved: string[];
}
export interface SourceCdcLineageAudit {
  metadataComplete: boolean;
  cdcApproved: false;
  database: string;
  feeds: SourceCdcLineage[];
  sharedPhysicalTables: Array<{ table: string; feeds: string[] }>;
  caveats: string[];
}

/** Pure graph audit: fail closed on hidden, cross-schema or cyclic dependencies. */
export function evaluateSourceCdcLineage(
  database: string, prefix: string,
  objects: readonly ObjectType[], usages: readonly Usage[],
): Omit<SourceCdcLineageAudit, "caveats"> {
  if (!ID.test(database) || !ID.test(prefix)) throw new Error("Invalid lineage identifiers");
  if (objects.length > MAX_OBJECTS || usages.length > MAX_OBJECTS * 8)
    throw new Error("Source schema metadata exceeds bounded audit");
  const types = new Map(objects.map(item => [database + "." + item.TABLE_NAME, item.TABLE_TYPE]));
  const edges = new Map<string, string[]>();
  for (const entry of usages) {
    const key = entry.VIEW_SCHEMA + "." + entry.VIEW_NAME;
    const target = entry.TABLE_SCHEMA + "." + entry.TABLE_NAME;
    edges.set(key, [...(edges.get(key) ?? []), target]);
  }
  const feeds: SourceCdcLineage[] = [];
  for (const feed of LOAD_ORDER) {
    const view = prefix + feed;
    const leaves = new Set<string>();
    const missing = new Set<string>();
    function visit(node: string, stack: Set<string>, depth: number): void {
      if (depth > 24 || stack.has(node)) { missing.add(node + " (cycle/depth)"); return; }
      if (!node.startsWith(database + ".")) { missing.add(node + " (cross-schema)"); return; }
      const type = types.get(node);
      if (type === "BASE TABLE") { leaves.add(node); return; }
      if (type !== "VIEW") { missing.add(node + " (missing or hidden)"); return; }
      const deps = edges.get(node);
      if (!deps?.length) { missing.add(node + " (no visible dependencies)"); return; }
      const next = new Set(stack);
      next.add(node);
      deps.forEach(dep => visit(dep, next, depth + 1));
    }
    visit(database + "." + view, new Set(), 0);
    feeds.push({ feed, view, physicalTables: [...leaves].sort(), unresolved: [...missing].sort() });
  }
  const reverse = new Map<string, Set<string>>();
  for (const feed of feeds) {
    for (const table of feed.physicalTables) {
      if (!reverse.has(table)) reverse.set(table, new Set());
      reverse.get(table)!.add(feed.feed);
    }
  }
  const sharedPhysicalTables = [...reverse.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([table, owners]) => ({ table, feeds: [...owners].sort() }))
    .sort((a, b) => a.table.localeCompare(b.table));
  return {
    metadataComplete: feeds.every(item => item.physicalTables.length > 0 && !item.unresolved.length),
    cdcApproved: false,
    database, feeds, sharedPhysicalTables,
  };
}

export async function inspectSourceCdcLineage(
  config: IntegrationSourceConfig,
): Promise<SourceCdcLineageAudit> {
  if (!directReportingEnabled()) throw new Error("Direct reporting is disabled");
  const source = effectiveSourceConfig(config);
  if (String(source.sourceMode ?? "").toUpperCase() !== "SQL" ||
      String(source.sqlDialect ?? "").toUpperCase() !== "MYSQL" ||
      source.sqlSsl !== true || source.sqlTrustServerCertificate === true)
    throw new Error("Verified-TLS MySQL source required for lineage");
  if (!source.sqlHost || !/^[A-Za-z0-9.-]{1,253}$/.test(source.sqlHost) ||
      !source.sqlUsername || !source.sqlPassword || !source.sqlDatabase ||
      !ID.test(source.sqlDatabase)) throw new Error("Invalid source connection");
  const prefix = source.sqlViewPrefix ?? "v_";
  if (!ID.test(prefix)) throw new Error("Invalid view prefix");
  const port = Number(source.sqlPort ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host: source.sqlHost, port, database: source.sqlDatabase,
    user: source.sqlUsername, password: source.sqlPassword,
    ssl: { rejectUnauthorized: true }, connectTimeout: 10_000,
    multipleStatements: false,
  });
  try {
    const [tables] = await conn.query({
      sql: `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? LIMIT 501`, timeout: 10_000,
    }, [source.sqlDatabase]);
    const [usages] = await conn.query({
      sql: `SELECT VIEW_SCHEMA, VIEW_NAME, TABLE_SCHEMA, TABLE_NAME
          FROM information_schema.VIEW_TABLE_USAGE
          WHERE VIEW_SCHEMA = ? LIMIT 4001`, timeout: 10_000,
    }, [source.sqlDatabase]);
    const base = evaluateSourceCdcLineage(
      source.sqlDatabase, prefix, tables as ObjectType[], usages as Usage[],
    );
    return {
      ...base,
      caveats: [
        "Metadata lineage is incomplete if the read account lacks privileges on dependencies.",
        "Review the view SQL, triggers and routines to confirm all affected employer keys can be reconstructed.",
        "A physical table contributing to multiple feeds must invalidate every dependent feed.",
        "CDC approval also requires FULL row images, safe cross-tenant transitions, retention and binlog continuity.",
      ],
    };
  } finally {
    await conn.end();
  }
}

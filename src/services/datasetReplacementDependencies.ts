// Read-only metadata audit. This code never mutates the database.
import { prisma } from "./snapshotBuilder.js";
type TableCost = {tableName:string;estimatedRows:bigint|number;tableBytes:bigint|number};
type ForeignKey = {dependentTable:string;parentTable:string;deleteRule:string};
export async function inspectReplacementDependencies() {
  const [sizes,keys] = await Promise.all([
    prisma.$queryRaw<TableCost[]>`
      SELECT c.relname AS "tableName", greatest(c.reltuples,0)::bigint AS "estimatedRows",
             pg_total_relation_size(c.oid)::bigint AS "tableBytes"
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
      ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 150
    `,
    prisma.$queryRaw<ForeignKey[]>`
      SELECT child.relname AS "dependentTable", parent.relname AS "parentTable",
      CASE con.confdeltype WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
        WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END AS "deleteRule"
      FROM pg_constraint con
      JOIN pg_class child ON child.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=con.confrelid
      WHERE con.contype='f' AND ns.nspname='public'
      ORDER BY child.relname,con.conname LIMIT 400
    `,
  ]);
  const preserved = new Set(['User','UserEmployer','Session','Partner','UserSectionAccess',
    'AdminAuditLog','ReportSchedule','ReportDeliveryLog','SecurityAlert','DataAccessEvent',
    'DataSubjectRequest','SourceActivationAudit','ChatSession','ScoreWeight','AchievableTarget']);
  return {
    mode:"READ_ONLY_DATABASE_DEPENDENCY_AUDIT",executable:false,
    tableSizes:sizes.map(t=>({table:t.tableName,estimatedRows:Number(t.estimatedRows),
      sizeBytes:Number(t.tableBytes),protected:preserved.has(t.tableName)})),
    foreignKeys:keys,
    blockedParentDeletes:[...new Set(keys.filter(k=>preserved.has(k.dependentTable)).map(k=>k.parentTable))],
    note:"Rows are planner estimates, not exact counts or billing estimates. No SQL modifications executed. Do not TRUNCATE CASCADE.",
  };
}

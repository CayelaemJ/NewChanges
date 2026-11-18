/** Default-off runtime configuration for the MySQL-only chart preview.
 * No reporting data/CDC writes to the PostgreSQL application store.
 * The operator must verify that app employer IDs exactly match MySQL
 * employer_ref values before enabling this preview.
 */
import type { CdcMysqlReaderSettings } from "./ingestStageCdcMysqlReader.js";

export function mysqlChartPreviewEnabled(env: NodeJS.ProcessEnv=process.env): boolean {
  return env.FIXER_CDC_MYSQL_CHART_PREVIEW_ENABLED === "true" &&
    env.FIXER_CDC_MYSQL_SOURCE_ACCESS_REVIEWED === "true" &&
    env.FIXER_CDC_MYSQL_BASELINE_VERIFIED === "true" &&
    env.FIXER_CDC_MYSQL_EMPLOYER_MAPPING_APPROVED === "true";
}

export function mysqlChartPreviewSettings(env: NodeJS.ProcessEnv=process.env): CdcMysqlReaderSettings {
  if (!mysqlChartPreviewEnabled(env))
    throw new Error("CDC_CHART_PREVIEW_DISABLED");
  const port = Number(env.FIXER_CDC_MYSQL_PORT ?? "3306");
  return {
    sourceId: env.FIXER_CDC_MYSQL_SOURCE_ID ?? "",
    featureEnabled: true,
    accessReviewed: true,
    snapshotVerified: true,
    hostname: env.FIXER_CDC_MYSQL_HOST ?? "",
    port,
    username: env.FIXER_CDC_MYSQL_READ_USER ?? "",
    password: env.FIXER_CDC_MYSQL_READ_PASSWORD ?? "",
    caCertificatePath: env.FIXER_CDC_MYSQL_CA_PATH ?? "",
    queryTimeoutMs: 5000,
    maxRows: 100,
  };
}

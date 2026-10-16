// AES-256-GCM encrypted candidate SQL/API source profiles. No secrets go
// into source generation metadata, logs, or browser JSON.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { IntegrationConfigPatch } from "./syncService.js";

export const SOURCE_SETTING_KEYS = [
  "sourceMode","baseUrl","authToken","sqlDialect","sqlHost","sqlPort",
  "sqlDatabase","sqlSchema","sqlUsername","sqlPassword","sqlSsl",
  "sqlTrustServerCertificate","sqlViewPrefix","sqlQueryTimeoutMs",
  "sqlMaxRowsPerReport",
] as const;

export function pickSourceSettings(input: object): IntegrationConfigPatch {
  const result: Record<string, unknown> = {};
  for (const key of SOURCE_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input,key) && (input as Record<string, unknown>)[key] !== undefined) result[key]=(input as Record<string, unknown>)[key];
  }
  return result as IntegrationConfigPatch;
}
function encryptionKey(env:NodeJS.ProcessEnv=process.env):Buffer {
  const raw=env.SOURCE_CONNECTION_VAULT_KEY ?? "";
  if(!/^[a-fA-F0-9]{64}$/.test(raw)) throw new Error("SOURCE_CONNECTION_VAULT_KEY requires exactly 32 bytes encoded as hex");
  return Buffer.from(raw,"hex");
}
export function sealSourceSettings(generationId:string,settings:IntegrationConfigPatch,env:NodeJS.ProcessEnv=process.env) {
  if(!generationId) throw new Error("Source generation ID required");
  const nonce=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",encryptionKey(env),nonce,{authTagLength:16});
  cipher.setAAD(Buffer.from(generationId,"utf8"));
  const ciphertext=Buffer.concat([
    cipher.update(JSON.stringify(pickSourceSettings(settings)),"utf8"),cipher.final(),
  ]);
  return {nonce:nonce.toString("base64"),ciphertext:ciphertext.toString("base64"),authTag:cipher.getAuthTag().toString("base64")};
}
export function openSourceSettings(generationId:string,record:{nonce:string;ciphertext:string;authTag:string},env:NodeJS.ProcessEnv=process.env):IntegrationConfigPatch {
  const nonce=Buffer.from(record.nonce,"base64"),tag=Buffer.from(record.authTag,"base64");
  if(nonce.length!==12||tag.length!==16) throw new Error("Invalid source vault record");
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(env),nonce,{authTagLength:16});
  decipher.setAAD(Buffer.from(generationId,"utf8"));
  decipher.setAuthTag(tag);
  const json=Buffer.concat([decipher.update(Buffer.from(record.ciphertext,"base64")),decipher.final()]).toString("utf8");
  const parsed:unknown=JSON.parse(json);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Invalid vault payload");
  return pickSourceSettings(parsed as Record<string,unknown>);
}

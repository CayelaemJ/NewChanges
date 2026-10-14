// Server-only S3 credential configuration. Avoid bundling credentials into
// client code, metadata, or source control; Railway bucket references remain
// environment variables and are resolved only at runtime.
export interface SemanticStorageSettings {
 endpoint:string;bucket:string;region:string;accessKeyId:string;secretAccessKey:string;urlStyle:"path"|"virtual-host";
}
export function loadSemanticStorageSettings(env:NodeJS.ProcessEnv=process.env):SemanticStorageSettings {
 const endpoint=env.SEMANTIC_S3_ENDPOINT||"";
 const bucket=env.SEMANTIC_S3_BUCKET||"";
 const region=env.SEMANTIC_S3_REGION||"auto";
 const accessKeyId=env.SEMANTIC_S3_ACCESS_KEY_ID||"";
 const secretAccessKey=env.SEMANTIC_S3_SECRET_ACCESS_KEY||"";
 const urlStyle=env.SEMANTIC_S3_URL_STYLE || "path";
 if(urlStyle!=="path" && urlStyle!=="virtual-host") throw new Error("Invalid S3 addressing style");
 if(!endpoint||!bucket||!accessKeyId||!secretAccessKey) throw new Error("Semantic S3 storage credentials are not configured");
 const url=new URL(endpoint);
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash) throw new Error("Storage endpoint must be a clean HTTPS URL");
 if(!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(bucket)) throw new Error("Invalid storage bucket identifier");
 return {endpoint:url.origin,bucket,region,accessKeyId,secretAccessKey,urlStyle};
}
export function publicSemanticStorageHealth(env:NodeJS.ProcessEnv=process.env) {
 const required=["SEMANTIC_S3_ENDPOINT","SEMANTIC_S3_BUCKET","SEMANTIC_S3_REGION","SEMANTIC_S3_ACCESS_KEY_ID","SEMANTIC_S3_SECRET_ACCESS_KEY"];
 return {configured:required.every(key=>Boolean(env[key])),missing:required.filter(key=>!env[key]),secretsReturned:false};
}

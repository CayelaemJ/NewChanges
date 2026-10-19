// Ensure the object we upload and read back is the exact immutable S3 key
// recorded in the semantic manifest. Presigned URLs are server-only secrets.
export function requireSemanticObjectUrlBinding(
  objectKey:string,putUrl:string,getUrl:string,
):void {
  if(!objectKey.startsWith("semantic/") || objectKey.includes("..") ||
     objectKey.includes("//") || objectKey.length>900 ||
     objectKey.split("/").some(x=>!x || x==="." || x===".."))
    throw new Error("Invalid semantic object key binding");
  let put:URL,get:URL;
  try {put=new URL(putUrl);get=new URL(getUrl);}
  catch {throw new Error("Invalid semantic storage URL");}
  for(const url of [put,get]) {
    if(url.protocol!=="https:" || url.username || url.password || url.hash)
      throw new Error("Semantic object storage requires clean HTTPS URLs");
    if(!/^[a-f0-9]{64}$/.test(url.searchParams.get("X-Amz-Signature")??"") ||
       url.searchParams.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256")
      throw new Error("Semantic object storage requires presigned S3 URLs");
    const encode=(v:string)=>encodeURIComponent(v).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    const keySuffix="/"+objectKey.split("/").map(encode).join("/");
    if(!url.pathname.endsWith(keySuffix))
      throw new Error("Presigned semantic URL does not match manifest object key");
  }
  if(put.origin!==get.origin || put.pathname!==get.pathname)
    throw new Error("Presigned semantic PUT/GET must address the same object");
}

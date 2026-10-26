import {readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const root=join(fileURLToPath(new URL(".",import.meta.url)),"..");
const pages=["public/login.html","public/set-password.html","public/users.html","public/admin.html"];
let checked=0;
for(const path of pages){
 const html=readFileSync(join(root,path),"utf8");
 const formIds=new Set([...html.matchAll(/<form\b[^>]*\bid=["']([^"']+)["']/gi)].map(m=>m[1]));
 const ranges=[...html.matchAll(/<\/?form\b[^>]*>/gi)];
 for(const match of html.matchAll(/<input\b[^>]*\btype=["']password["'][^>]*>/gi)){
  const tag=match[0],owner=tag.match(/\bform=["']([^"']+)["']/i)?.[1];
  if(owner){if(!formIds.has(owner))throw Error(path+": password form owner missing: "+owner);}
  else{
   let inside=false;
   for(const m of ranges){if(m.index>=match.index)break;inside=!/^<\/form/i.test(m[0]);}
   if(!inside)throw Error(path+": password input outside form: "+(tag.match(/\bid=["']([^"']+)/)?.[1]||"unknown"));
  }
  checked++;
 }
}
const activation=readFileSync(join(root,"public/set-password.html"),"utf8");
if(!activation.includes('onsubmit="event.preventDefault();setPassword()"') ||
 !activation.includes("async function setPassword()")) {
 throw Error("Password activation must use a non-shadowed form submit handler");
}
if(checked<8)throw Error("Expected at least eight password fields across pages; found "+checked);
console.log("Password form associations verified across",pages.length,"pages and",checked,"fields.");

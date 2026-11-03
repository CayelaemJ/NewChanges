// Parse the actual TypeScript route registrations instead of maintaining
// a hand-picked allowlist that silently misses newly added endpoints.
import ts from 'typescript';
import {readFileSync} from 'node:fs';

const files=['src/server.ts','src/services/adminMfaRoutes.ts'];
const methods=new Set(['get','post','put','patch','delete','options','head']);
const literal=node=>ts.isStringLiteralLike(node)?node.text:null;
export function apiRouteInventory(){
 const found=[];const dynamic=[];
 for(const file of files){
  const src=readFileSync(file,'utf8');
  const tree=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const walk=node=>{
   if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
      node.expression.expression.getText(tree)==='app'){
    const method=node.expression.name.text.toLowerCase();
    if(methods.has(method)){
      const path=literal(node.arguments[0]);
      if(path?.startsWith('/api/'))found.push({method:method.toUpperCase(),path,file});
      else if(path===null&&node.arguments.length){
        // Dynamic path registration must be manually classified if introduced.
        dynamic.push({file,expression:node.arguments[0].getText(tree).slice(0,120)});
      }
    }
   }
   ts.forEachChild(node,walk);
  };
  walk(tree);
 }
 const dedup=[...new Map(found.map(x=>[x.method+' '+x.path,x])).values()]
   .sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
 return {routes:dedup,dynamic};
}

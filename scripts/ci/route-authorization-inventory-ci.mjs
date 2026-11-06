import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {apiRouteInventory} from './api-route-inventory.mjs';
import {requiresAdminMfaStepUp} from '../../dist/services/adminMfaRouteScope.js';

const {routes,dynamic}=apiRouteInventory();
const mutation=new Set(['POST','PUT','PATCH','DELETE']);
assert.ok(routes.length>=40,'Expected >=40 actual statically registered API routes; inventory incomplete');
const tested=[];
for(const route of routes){
 const {method,path}=route;
 const scope=requiresAdminMfaStepUp(method,path);
 const admin=path==='/api/admin'||path.startsWith('/api/admin/');
 const publicCeremony=path==='/api/contact'||path==='/api/auth'||path.startsWith('/api/auth/');
 assert.equal(scope.adminOnly,admin,'Admin route scope mismatch: '+method+' '+path);
 assert.equal(scope.adminMutation,mutation.has(method)&&!publicCeremony,
   'Mutation must require MFA: '+method+' '+path);
 tested.push({...route,scope});
}
mkdirSync('test-results/authorization',{recursive:true});
writeFileSync('test-results/authorization/route-inventory.json',
 JSON.stringify({routeCount:tested.length,dynamicCount:dynamic.length,routes:tested,dynamic},null,2));
console.log('[authorization-inventory] PASS',tested.length,'actual registered paths classified and MFA mutation policy checked');
if(dynamic.length)console.log('[authorization-inventory] ATTENTION',dynamic.length,
  'dynamic route arguments require manual audit; see inventory report');

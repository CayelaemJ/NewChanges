// Synthetic staging fixture provisioning, never a production account seeder.
// All credentials and enrollment codes arrive via Render environment settings,
// not code, repository files, logs or a publicly callable endpoint.
import { createHash } from 'node:crypto';
import { prisma } from '../dist/services/database.js';
import { hashPassword } from '../dist/services/authService.js';
import {approvedStagingDatabaseEnvironment} from './mfa-staging-db-target.mjs';

const guard = approvedStagingDatabaseEnvironment(process.env) &&
  (process.env.ADMIN_MFA_ENFORCE==='false' ||
   (process.env.ADMIN_MFA_ENFORCE==='true' &&
    process.env.MFA_STAGING_ENFORCEMENT_APPROVED==='true'));

if (!guard) throw new Error('Synthetic-only staging fixture provisioning refused');
const passwordNames=['MFA_STAGING_ADMIN_A_PASSWORD','MFA_STAGING_ADMIN_B_PASSWORD',
 'MFA_STAGING_TARGET_PASSWORD'];
const grantNames=['MFA_STAGING_ADMIN_A_GRANT','MFA_STAGING_ADMIN_B_GRANT',
 'MFA_STAGING_TARGET_GRANT'];
const passwords=passwordNames.map(x=>process.env[x]);
const grants=grantNames.map(x=>process.env[x]);
for(const p of passwords){
 if(typeof p!=='string'||Buffer.byteLength(p,'utf8')<24||
  Buffer.byteLength(p,'utf8')>256||p===process.env.MFA_STAGING_GATE_PASSWORD)
  throw new Error('Synthetic staging passwords must be unique and sufficiently strong');
}
if(new Set(passwords).size!==3 || new Set(grants).size!==3)
 throw new Error('Each synthetic administrator needs distinct credentials and grants');
for(const code of grants)
 if(typeof code!=='string'|| !/^[A-Za-z0-9_-]{43}$/.test(code))
  throw new Error('Synthetic grants must be independent 32-byte base64url values');

const fixtures=[
 {email:'mfa-superadmin-a@example.invalid',role:'SUPERADMIN',label:'Synthetic Superadmin A',password:passwords[0],grant:grants[0]},
 {email:'mfa-superadmin-b@example.invalid',role:'SUPERADMIN',label:'Synthetic Superadmin B',password:passwords[1],grant:grants[1]},
 {email:'mfa-recovery-target@example.invalid',role:'ADMIN',label:'Synthetic Recovery Target',password:passwords[2],grant:grants[2]},
];
try {
 const count=await prisma.user.count();
 if(count!==0){
  const existing=await prisma.user.findMany({where:{email:{in:fixtures.map(x=>x.email)}},
   select:{email:true,role:true,active:true}});
  if(count===fixtures.length && existing.length===fixtures.length &&
     existing.every(x=>x.active && x.role===fixtures.find(y=>y.email===x.email)?.role)){
   process.stdout.write('Synthetic MFA fixtures already exist; no changes made.\n');
   process.exit(0);
  }
  throw new Error('Synthetic MFA fixture bootstrap requires an empty isolated database');
 }
 await prisma.$transaction(async tx=>{
  for(const user of fixtures){
   const added=await tx.user.create({data:{
    email:user.email,name:user.label,
    role:user.role,passwordHash:hashPassword(user.password),active:true,
    createdBy:'synthetic-staging-bootstrap',
   }});
   await tx.adminMfaEnrollmentGrant.create({data:{
    userId:added.id,codeHash:createHash('sha256').update(user.grant).digest('hex'),
    expiresAt:new Date(Date.now()+24*60*60*1000),
    approvedByOne:'synthetic-staging-bootstrap-step-one',
    approvedByTwo:'synthetic-staging-bootstrap-step-two',
   }});
  }
 });
 process.stdout.write('Three synthetic MFA accounts (two superadmins and one target) created without logging credentials.\n');
} finally {await prisma.$disconnect();}

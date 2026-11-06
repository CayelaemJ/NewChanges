// Explicit first-two-superadmins bootstrap only. This script is NEVER part
// of app startup, CI, migrations, or scheduled jobs. It does not touch users'
// passwords or existing MFA factors. Only an authorized security operator
// with independently obtained dual approval may execute it in a private TTY.
import {createHash,randomBytes} from 'node:crypto';
import {prisma} from '../dist/services/database.js';

const required='INITIAL_TWO_SUPERADMINS_ONLY';
const fail=message=>{throw new Error(message);};
if(process.env.CI || !process.stdin.isTTY || !process.stdout.isTTY)
 fail('Refusing bootstrap without an interactive private operator terminal');
if(process.env.MFA_BOOTSTRAP_CONFIRM!==required)
 fail('Explicit initial-superadmin bootstrap confirmation is required');
const emails=[
 String(process.env.MFA_BOOTSTRAP_SUPERADMIN_A_EMAIL||'').trim().toLowerCase(),
 String(process.env.MFA_BOOTSTRAP_SUPERADMIN_B_EMAIL||'').trim().toLowerCase(),
];
const approvals=[
 String(process.env.MFA_BOOTSTRAP_APPROVER_A||'').trim(),
 String(process.env.MFA_BOOTSTRAP_APPROVER_B||'').trim(),
];
if(emails.some(x=>!x || !x.includes('@')) || emails[0]===emails[1])
 fail('Two different existing superadmin emails must be explicitly selected');
if(approvals.some(x=>x.length<8||x.length>128) || approvals[0]===approvals[1])
 fail('Two different, out-of-band identity-verified operator approvals are required');
if(!process.env.DATABASE_URL)
 fail('Database configuration unavailable');
const now=new Date();
const ttlMs=10*60_000;
const values=emails.map(()=>randomBytes(32).toString('base64url'));
const hash=v=>createHash('sha256').update(v).digest('hex');
try{
 await prisma.$transaction(async tx=>{
  const targets=await tx.user.findMany({
   where:{email:{in:emails},role:'SUPERADMIN',active:true},
   select:{id:true,email:true,passwordHash:true},
  });
  if(targets.length!==2 || targets.some(x=>!x.passwordHash))
   fail('Both existing, active superadmins must have completed password setup');
  const everyone=await tx.user.findMany({
   where:{role:'SUPERADMIN',active:true},select:{id:true},
  });
  // This is *first* bootstrap, not a backdoor to replace current MFA.
  const ids=everyone.map(x=>x.id);
  const [passkeys,totp]=await Promise.all([
   tx.adminMfaCredential.count({where:{userId:{in:ids},revokedAt:null}}),
   tx.adminMfaTotp.count({where:{userId:{in:ids},enabledAt:{not:null}}}),
  ]);
  if(passkeys || totp)
   fail('An active superadmin MFA factor exists; bootstrap is no longer permitted');
  const existing=await tx.adminMfaEnrollmentGrant.count({
   where:{userId:{in:targets.map(x=>x.id)},consumedAt:null,expiresAt:{gt:now}},
  });
  if(existing)fail('Unexpired bootstrap grants already exist');
  for(let i=0;i<emails.length;i++){
   const target=targets.find(x=>x.email===emails[i]);
   if(!target)fail('Selected superadmin missing');
   await tx.adminMfaEnrollmentGrant.create({data:{
    userId:target.id,codeHash:hash(values[i]),
    approvedByOne:approvals[0],approvedByTwo:approvals[1],
    expiresAt:new Date(now.getTime()+ttlMs),
   }});
   await tx.adminAuditLog.create({data:{
    actorEmail:'security-operator@bootstrap.invalid',
    actorName:'Initial MFA bootstrap security operator',
    action:'security.mfa.bootstrap.grant_issued',
    targetType:'User',targetId:target.id,
    summary:'Initial superadmin enrollment authorized by two independently verified operators',
    riskLevel:'HIGH',flagged:true,
   }});
  }
 });
 process.stdout.write('\nINITIAL MFA BOOTSTRAP: deliver each one-time code to its corresponding verified superadmin.\n');
 process.stdout.write('Expires in 10 minutes. Codes are not recoverable; do not paste them into tickets or logs.\n');
 for(let i=0;i<emails.length;i++)
  process.stdout.write(emails[i]+' : '+values[i]+'\n');
 process.stdout.write('Once enrolled, each superadmin receives a separate personal recovery key to save.\n');
}finally{await prisma.$disconnect();}

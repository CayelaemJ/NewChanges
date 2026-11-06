// Controlled *local disposable fixture only* bootstrap and recovery utility.
// Production recovery must use an independently approved, auditable operator process.
import {randomBytes,createHash} from 'node:crypto';
import {prisma} from '../src/services/database.js';

const approvedDatabase='postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci';
const action=process.env.MFA_OPERATOR_ACTION;
const target=process.env.MFA_TARGET_EMAIL?.toLowerCase().trim();
const one=process.env.MFA_APPROVER_ONE?.trim();
const two=process.env.MFA_APPROVER_TWO?.trim();
if (process.env.DATABASE_URL!==approvedDatabase || process.env.CI_RLS_PROBE_APPROVED!=='CI_DISPOSABLE_ONLY') {
  throw new Error('Refusing non-disposable database: this utility never touches production');
}
if(!['enroll','recover'].includes(action||'') || !target || !one || !two || one===two || one.length<3 || two.length<3) {
  throw new Error('Provide action, target email and two distinct independently verified approvers');
}
try {
 const user=await prisma.user.findUnique({where:{email:target}});
 if(!user || !user.active || !['ADMIN','SUPERADMIN'].includes(user.role)) throw new Error('Active administrator not found');
 const code=randomBytes(32).toString('base64url');
 const now=new Date();
 await prisma.$transaction(async tx=>{
   if(action==='recover'){
     await tx.adminMfaCredential.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:now}});
     await tx.session.updateMany({where:{userId:user.id,endedAt:null},data:{endedAt:now,revokedAt:now}});
     await tx.adminMfaChallenge.deleteMany({where:{userId:user.id}});
   }
   await tx.adminMfaEnrollmentGrant.updateMany({where:{userId:user.id,consumedAt:null},data:{consumedAt:now}});
   await tx.adminMfaEnrollmentGrant.create({data:{
     userId:user.id,codeHash:createHash('sha256').update(code).digest('hex'),
     approvedByOne:one!,approvedByTwo:two!,expiresAt:new Date(now.getTime()+10*60_000),
   }});
   await tx.adminAuditLog.create({data:{
      actorEmail:'local-mfa-operator',actorName:'Local MFA operator',action:'MFA_'+action!.toUpperCase(),
      targetType:'User',targetId:user.id,summary:'Synthetic local MFA grant issued under dual review',
      detail:{approverOne:one,approverTwo:two,grantExpiryMinutes:10},
      riskLevel:'HIGH',flagged:true,
   }});
 });
 // Printed only in the intentionally invoked local operator session, never in CI reports.
 process.stdout.write('LOCAL SYNTHETIC MFA GRANT (expires in 10 minutes): '+code+'\n');
} finally {await prisma.$disconnect();}

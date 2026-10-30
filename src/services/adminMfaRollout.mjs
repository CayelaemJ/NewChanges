// Fail-closed administrator MFA rollout policy.
// Do not enable enforcement until the complete registration, sign-in,
// recovery and verified-session lifecycle are proven in staging.
export const ADMIN_MFA_ENFORCEMENT_READY = false;

export function adminMfaGate({user, session, now=Date.now(), maxAgeMs=10*60*1000}) {
 if(!user || !['ADMIN','SUPERADMIN'].includes(user.role) || user.active!==true) return {allowed:false,reason:'role'};
 if(!session || session.userId!==user.id || session.endedAt || session.revokedAt ||
    new Date(session.expiresAt).getTime()<=now) return {allowed:false,reason:'session'};
 const verified=new Date(session.mfaVerifiedAt ?? 0).getTime();
 if(!session.mfaVerifiedAt || !Number.isFinite(verified) || verified>now ||
    now-verified>maxAgeMs) return {allowed:false,reason:'mfa_required'};
 return {allowed:true,reason:'verified'};
}

// Recovery must be performed by a separately authenticated support process;
// never silently disable MFA or allow self-service password-only reset.
export function recoveryRequirements({independentIdentityCheck, twoPersonApproval,
    auditRecorded, allSessionsRevoked, credentialsReplaced}) {
 return [independentIdentityCheck,twoPersonApproval,auditRecorded,
         allSessionsRevoked,credentialsReplaced].every(v=>v===true);
}

// Keep production rollout gated until the complete all-account registration,
// sign-in, recovery and verified-session lifecycle has passed acceptance.
export const ALL_ACCOUNT_MFA_ENFORCEMENT_READY = false;

export function accountMfaGate({user, session, now=Date.now(), maxAgeMs=10*60*1000}) {
 if(!user || user.active!==true) return {allowed:false,reason:'account'};
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

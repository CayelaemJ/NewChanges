// ════════════════════════════════════════════════════════════════════
//  USER MANAGEMENT (admin only)
//  Create users with a temp password OR a set-password link, list them,
//  update role/links/active, and complete the set-password flow.
// ════════════════════════════════════════════════════════════════════

import { randomBytes } from "node:crypto";
import { prisma, hashPassword, digestSetupToken } from "./authService.js";
import { sendMail, portalBaseUrl } from "./reportScheduler.js";
import { notifyAdmins } from "./automationService.js";
import { assertSuperadminRetirementAllowed } from "./superadminAvailabilityPolicy.js";
import { safeEmailDeliveryFailure } from "./emailDeliveryFailure.js";

type Role = "ADMIN" | "SUPERADMIN" | "EMPLOYER_MANAGER" | "PORTFOLIO_MANAGER" | "VIEWER";

function validatePassword(password: string) {
  if (typeof password !== "string" || password.length < 12) throw new Error("password must be at least 12 characters");
  if (password.length > 128) throw new Error("password must be 128 characters or fewer");
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("password must contain upper-case, lower-case, and numeric characters");
  }
}

export async function createUser(opts: {
  email: string;
  name: string;
  role: Role;
  employerIds: string[];
  partnerId?: string | null;
  tempPassword?: string;   // if provided, account is ready to use
  sendSetupLink?: boolean; // if true, generate a one-time setup token instead
  createdBy?: string;
}) {
  const email = opts.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("a user with that email already exists");

  let passwordHash: string | null = null;
  let setupToken: string | null = null;
  let setupTokenForLink: string | null = null;
  let setupExpires: Date | null = null;

  if (opts.sendSetupLink) {
    const rawSetupToken = randomBytes(32).toString("hex");
    setupTokenForLink = rawSetupToken;
    setupToken = digestSetupToken(rawSetupToken);
    setupExpires = new Date(Date.now() + 3 * 864e5); // 3 days
  } else if (opts.tempPassword) {
    validatePassword(opts.tempPassword);
    passwordHash = hashPassword(opts.tempPassword);
  } else {
    throw new Error("provide either a temporary password or choose to send a setup link");
  }

  const user = await prisma.user.create({
    data: {
      email, name: opts.name, role: opts.role,
      passwordHash, setupToken, setupExpires, createdBy: opts.createdBy,
      partnerId: opts.partnerId || null,
      links: { create: opts.employerIds.map((employerId) => ({ employerId })) },
    },
    include: { links: true },
  });

  // the setup link the admin can copy/send (relative path; prefix with your domain)
  const setupPath = setupTokenForLink ? `/set-password?token=${setupTokenForLink}` : null;

  // try to email the setup link automatically; if SMTP isn't configured or
  // sending fails for any reason, we don't fail user creation — the admin
  // still gets setupPath back in the response to copy/send manually as a fallback.
  let emailSent = false;
  let emailError: string | null = null;
  if (setupPath) {
    try {
      const base = (await portalBaseUrl()) || "";
      const link = base ? `${base.replace(/\/$/, "")}${setupPath}` : setupPath;
      await sendMail({
        to: email,
        subject: "Set up your The Fixer (Pty) Ltd Dashboard Portal account",
        html: `<div style="font-family:Arial,sans-serif;color:#241536;max-width:620px">
          <h2 style="color:#32217c">You've been added to the Dashboard Portal</h2>
          <p>Hi ${escapeHtml(opts.name || "")},</p>
          <p>An admin has created an account for you. Click below to set your password and log in:</p>
          <p style="margin:24px 0"><a href="${link}" style="background:#32217c;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Set your password</a></p>
          <p style="color:#6b7280;font-size:13px">This link expires in 3 days. If the button doesn't work, copy this link: ${link}</p>
        </div>`,
      });
      emailSent = true;
    } catch (e: any) {
      // Invite-link delivery failures are returned to the admin UI. Never
      // surface SMTP banners, transport credentials, or remote API bodies.
      emailError = safeEmailDeliveryFailure(e);
    }
  }

  return { user: sanitize(user), setupPath, emailSent, emailError };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// self-service: "forgot password" — reuses the same setupToken/expiry fields
// as the admin-issued setup link, and always responds success either way so
// we don't leak which emails have accounts.
export async function requestPasswordReset(email: string) {
  const normalised = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalised } });
  if (!user || !user.active) return { ok: true }; // don't reveal account existence/status
  const rawSetupToken = randomBytes(32).toString("hex");
  const setupToken = digestSetupToken(rawSetupToken);
  const setupExpires = new Date(Date.now() + 2 * 3600e3); // 2 hours — shorter than the 3-day admin invite link
  // Active state is checked at the write boundary too. An administrator
  // may have revoked the account after the initial lookup.
  const issued = await prisma.user.updateMany({
    where: { id: user.id, active: true },
    data: { setupToken, setupExpires },
  });
  if (issued.count !== 1) return { ok: true };
  const setupPath = `/set-password?token=${rawSetupToken}`;
  try {
    const base = (await portalBaseUrl()) || "";
    const link = base ? `${base.replace(/\/$/, "")}${setupPath}` : setupPath;
    await sendMail({
      to: user.email,
      subject: "Reset your The Fixer (Pty) Ltd Dashboard Portal password",
      html: `<div style="font-family:Arial,sans-serif;color:#241536;max-width:620px">
        <h2 style="color:#32217c">Reset your password</h2>
        <p>Hi ${escapeHtml(user.name || "")},</p>
        <p>We got a request to reset the password on this account. Click below to choose a new one:</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#32217c;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Reset password</a></p>
        <p style="color:#6b7280;font-size:13px">This link expires in 2 hours. If you didn't request this, you can safely ignore this email — your password won't change.</p>
      </div>`,
    });
  } catch { /* best-effort — never reveal a send failure to the caller either */ }
  return { ok: true };
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      links: { include: { employer: { select: { id: true, name: true } } } },
      partner: { select: { id: true, name: true, displayName: true } },
    },
  });
  return users.map((u: any) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, active: u.active,
    hasPassword: !!u.passwordHash,
    // A user is "pending setup" only if they've never actually set a
    // password — not just because a setupToken row exists. The same token
    // field is reused for self-service "forgot password" requests (see
    // requestPasswordReset above); if someone with a working password
    // requests a reset link but then just logs in with their existing
    // password instead of using it, the leftover unused token was
    // incorrectly making a fully active account show "pending setup" forever.
    pendingSetup: !u.passwordHash,
    employers: u.links.map((l: any) => ({ id: l.employer.id, name: l.employer.name })),
    partner: u.partner ? { id: u.partner.id, name: u.partner.displayName || u.partner.name } : null,
    createdAt: u.createdAt,
  }));
}

export async function updateUser(userId: string, patch: {
  name?: string; role?: Role; active?: boolean; employerIds?: string[]; partnerId?: string | null;
  revokedReason?: string; revokedBy?: string;
}, options: { forbidSuperadminTarget?: boolean } = {}) {
  const accessChanged = patch.role !== undefined ||
    patch.active !== undefined ||
    patch.employerIds !== undefined ||
    Object.prototype.hasOwnProperty.call(patch, "partnerId");
  const revokeFields: Record<string, unknown> = {};
  if (patch.active === false) {
    revokeFields.revokedAt = new Date();
    revokeFields.setupToken = null;
    revokeFields.setupExpires = null;
    revokeFields.revokedReason = patch.revokedReason || "No reason given";
    revokeFields.revokedBy = patch.revokedBy || "admin";
  } else if (patch.active === true) {
    revokeFields.revokedAt = null;
    revokeFields.revokedReason = null;
    revokeFields.revokedBy = null;
  }

  return prisma.$transaction(async tx => {
    if (patch.role !== undefined || patch.active !== undefined) {
      // Serialize *all* role/active-state changes in this account service.
      // Without a transaction-wide lock, two concurrent demotions could each
      // see two active superadmins and together remove the entire control plane.
      // The query projects an integer, not PostgreSQL's unsupported void type.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(761231, 20261105)`;
      const current = await tx.user.findUnique({
        where: { id: userId }, select: { role: true, active: true },
      });
      if (!current) throw new Error("user not found or no longer editable");
      const activeSuperadmins = await tx.user.count({
        where: { role: "SUPERADMIN", active: true },
      });
      assertSuperadminRetirementAllowed(current, patch, activeSuperadmins);
    }
    let validEmployerIds: string[] | undefined;
    if (patch.employerIds !== undefined) {
      if (!Array.isArray(patch.employerIds) || patch.employerIds.length > 5000 ||
        patch.employerIds.some(id => typeof id !== "string" || !id || id.length > 128))
        throw new Error("Invalid employerIds");
      const requested = [...new Set(patch.employerIds)];
      const existing = await tx.employer.findMany({
        where: { id: { in: requested } }, select: { id: true },
      });
      if (existing.length !== requested.length)
        throw new Error("One or more employer IDs do not exist");
      validEmployerIds = requested;
    }

    // This role predicate is enforced by the same database write that applies
    // the change. A pre-request role lookup may become stale under concurrent
    // promotion; an ordinary admin may never edit a SUPERADMIN target.
    const updated = await tx.user.updateMany({
      where: {
        id: userId,
        ...(options.forbidSuperadminTarget ? { role: { not: "SUPERADMIN" as const } } : {}),
      },
      data: {
        name: patch.name, role: patch.role as any, active: patch.active,
        ...("partnerId" in patch ? { partnerId: patch.partnerId || null } : {}),
        ...revokeFields,
      },
    });
    if (updated.count !== 1) throw new Error("user not found or no longer editable");

    if (validEmployerIds !== undefined) {
      await tx.userEmployer.deleteMany({ where: { userId } });
      if (validEmployerIds.length) {
        await tx.userEmployer.createMany({
          data: validEmployerIds.map(employerId => ({ userId, employerId })),
          skipDuplicates: true,
        });
      }
    }

    if (accessChanged) {
      const now = new Date();
      await tx.session.updateMany({
        where: { userId, endedAt: null },
        data: {
          endedAt: now, revokedAt: now, revokedBy: "admin_permission_changed",
        },
      });
    }

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: { links: { include: { employer: { select: { id: true, name: true } } } } },
    });
    return sanitize(user);
  });
}

// self-service: a user disables their own account. Ends their own session too,
// since the deactivation should take effect immediately.
export async function deactivateSelf(userId: string, reason?: string) {
  const now = new Date();
  // A superadmin cannot retire their own control-plane access through the
  // general user endpoint. Privileged account retirement requires another
  // authorized admin and the final-superadmin availability check.
  const user = await prisma.$transaction(async tx => {
    const disabled = await tx.user.updateMany({
      where: { id: userId, active: true, role: { not: "SUPERADMIN" } },
      data: { active: false, setupToken: null, setupExpires: null, revokedAt: now,
        revokedReason: reason || "Deactivated by the user", revokedBy: "self" },
    });
    if (disabled.count !== 1)
      throw new Error("Account cannot self-deactivate; contact a superadministrator");
    await tx.session.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: now, revokedAt: now, revokedBy: "self_deactivation" },
    });
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });
  notifyAdmins({
    subject: "A user deactivated their own account",
    html: `<div style="font-family:Arial,sans-serif;color:#241536"><h2 style="color:#32217c">Self-deactivation</h2><p><b>${escapeHtml(user.name)}</b> (${escapeHtml(user.email)}) deactivated their own account.</p>${reason ? `<p>Reason given: "${escapeHtml(String(reason).slice(0, 300))}"</p>` : ""}<p style="color:#6b7280;font-size:13px">Reactivate from Past users if this wasn't intended.</p></div>`,
    slackText: `:door: ${user.name} (${user.email}) deactivated their own account${reason ? `: "${reason}"` : "."}`,
  }).catch(() => {}); // best-effort — never block the user's own deactivation on this
  return sanitize(user);
}

// admin-only: past users — anyone currently inactive, with the revocation audit
// trail, so admins can see who once had access and why it was revoked.
export async function listRevokedUsers() {
  const users = await prisma.user.findMany({
    where: { active: false },
    orderBy: { revokedAt: "desc" },
    include: { partner: { select: { id: true, name: true, displayName: true } } },
  });
  return users.map((u: any) => ({
    id: u.id, email: u.email, name: u.name, role: u.role,
    partner: u.partner ? (u.partner.displayName || u.partner.name) : null,
    createdAt: u.createdAt,
    revokedAt: u.revokedAt, revokedReason: u.revokedReason, revokedBy: u.revokedBy,
  }));
}

// admin-only: permanent delete. Only allowed on an already-deactivated account,
// so nobody is removed without first going through the revoke/audit step.
export async function deleteUserPermanently(
  userId: string,
  options: { forbidSuperadminTarget?: boolean } = {},
) {
  // Both conditions are checked at the actual DELETE boundary, not only by
  // a preceding route-level lookup. Cascading session deletion is governed by
  // the Session.user FK in the database and rolls back on any FK failure.
  const deleted = await prisma.user.deleteMany({
    where: {
      id: userId,
      active: false,
      ...(options.forbidSuperadminTarget ? { role: { not: "SUPERADMIN" as const } } : {}),
    },
  });
  if (deleted.count !== 1)
    throw new Error("account must be deactivated and editable before deletion");
  return { ok: true };
}

export async function resetPassword(
  userId: string,
  newPassword: string,
  options: { forbidSuperadminTarget?: boolean } = {},
) {
  validatePassword(newPassword);
  const passwordHash = hashPassword(newPassword);
  const now = new Date();
  await prisma.$transaction(async tx => {
    // The role guard must be in the password UPDATE predicate. An ordinary
    // admin cannot reset a privileged account, even across role-change races.
    const updated = await tx.user.updateMany({
      where: {
        id: userId,
        ...(options.forbidSuperadminTarget ? { role: { not: "SUPERADMIN" as const } } : {}),
      },
      data: { passwordHash, setupToken: null, setupExpires: null },
    });
    if (updated.count !== 1) throw new Error("user not found or no longer editable");
    await tx.session.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: now, revokedAt: now, revokedBy: "password_changed" },
    });
  });
  return { ok: true };
}

// set-password flow (user clicks the emailed link)
export async function completeSetup(token: string, newPassword: string) {
  validatePassword(newPassword);
  if (typeof token !== "string" || token.length < 32 || token.length > 256)
    throw new Error("this setup link is invalid or has expired");
  const digest = digestSetupToken(token);
  const passwordHash = hashPassword(newPassword);
  const invalid = () => new Error("this setup link is invalid or has expired");
  await prisma.$transaction(async tx => {
    // The initial lookup is only to identify the account. It does NOT grant
    // permission to change its password; the conditional write below does.
    const account = await tx.user.findFirst({
      where: { OR: [{ setupToken: digest }, { setupToken: token }] },
      select: { id: true },
    });
    if (!account) throw invalid();
    const now = new Date();
    // A concurrent request that already consumed/expired the token must
    // lose at the DATABASE write boundary, not at a stale application read.
    const used = await tx.user.updateMany({
      where: {
        id: account.id,
        active: true, // An old invitation/reset link must NEVER revive a revoked user.
        OR: [{ setupToken: digest }, { setupToken: token }],
        setupExpires: { gt: now },
      },
      data: { passwordHash, setupToken: null, setupExpires: null },
    });
    if (used.count !== 1) throw invalid();
    // Existing sessions cannot survive a password reset. Commit this
    // revocation atomically with the password change, including MFA sessions.
    await tx.session.updateMany({
      where: { userId: account.id, endedAt: null },
      data: { endedAt: now, revokedAt: now, revokedBy: "password_changed" },
    });
  });
  return { ok: true };
}

function sanitize(u: any) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, employers: (u.links ?? []).map((l: any) => l.employerId) };
}

export { prisma };

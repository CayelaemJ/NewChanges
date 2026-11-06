import { isAdminRole } from "./authService.js";
import nodemailer from "nodemailer";
import { DateTime } from "luxon";
import { prisma, getDashboardPayload } from "./snapshotBuilder.js";
import { themeForEmployer } from "./partnerService.js";
import { allowedSlackWebhookUrl } from "./slackWebhookPolicy.js";
import { notificationPlainText, safeEmailColor, safePortalBaseUrl } from "./notificationTextSafety.js";
import { reportDeliveryAllowed } from "./reportDeliveryPolicy.js";
import { assertSecureSmtpTls } from "./smtpTlsPolicy.js";
import { resolveEmailProviderConfig } from "./emailProviderConfig.js";
import { safeEmailDeliveryFailure } from "./emailDeliveryFailure.js";

export type ReportFilters = {
  period?: string;
  range?: "30d" | "quarter" | "all";
  site?: string;
  income?: string;
};

type EmailDraft = {
  emailProvider?: "smtp" | "resend";
  resendApiKey?: string | null;
  resendFromEmail?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  smtpRequireTls?: boolean;
  smtpRejectUnauthorized?: boolean;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  defaultTimezone?: string | null;
  portalBaseUrl?: string | null;
  alertEmails?: string | null;
  alertSlackWebhookUrl?: string | null;
  digestEnabled?: boolean;
  staleDeactivateDays?: number | null;
  scoreChangeAlertsEnabled?: boolean;
  syntheticDataMode?: boolean;
};

export type ScheduleInput = {
  employerId: string;
  name?: string;
  frequency: "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY";
  timezone?: string;
  sendTime?: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  onceDate?: string | null;
  filters?: ReportFilters;
  recipients?: string[];
};

const boolEnv = (name: string): boolean | undefined => {
  const raw = process.env[name];
  if (raw == null || raw === "") return undefined;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
};
const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

export async function getEmailConfig() {
  return prisma.systemEmailConfig.upsert({ where: { id: "default" }, create: { id: "default", fromName: "The Fixer (Pty) Ltd Dashboard Portal" }, update: {} });
}

function withEnv(cfg: any, draft: EmailDraft = {}) {
  const pick = <T>(draftValue: T | undefined, envValue: T | undefined, savedValue: T): T =>
    draftValue !== undefined ? draftValue : envValue !== undefined ? envValue : savedValue;
  const draftString = (key: keyof EmailDraft) => draft[key] === undefined ? undefined : clean(draft[key]);
  const envString = (name: string) => process.env[name] === undefined ? undefined : clean(process.env[name]);
  const envPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const provider = resolveEmailProviderConfig(cfg, draft);
  return {
    ...provider,
    smtpHost: pick(draftString("smtpHost") as any, envString("SMTP_HOST") as any, cfg.smtpHost),
    smtpPort: pick(draft.smtpPort ?? undefined, Number.isFinite(envPort) ? envPort : undefined, cfg.smtpPort),
    smtpSecure: pick(draft.smtpSecure, boolEnv("SMTP_SECURE"), cfg.smtpSecure),
    smtpRequireTls: pick(draft.smtpRequireTls, boolEnv("SMTP_REQUIRE_TLS"), cfg.smtpRequireTls),
    smtpRejectUnauthorized: pick(draft.smtpRejectUnauthorized, boolEnv("SMTP_REJECT_UNAUTHORIZED"), cfg.smtpRejectUnauthorized),
    smtpUsername: pick(draftString("smtpUsername") as any, envString("SMTP_USERNAME") as any, cfg.smtpUsername),
    smtpPassword: pick(draftString("smtpPassword") as any, envString("SMTP_PASSWORD") as any, cfg.smtpPassword),
    fromName: (() => {
      const name = clean(pick(draftString("fromName") as any, envString("SMTP_FROM_NAME") as any, cfg.fromName));
      return !name || /^empower[ -]?(?:fin|fs)(?: \(Pty\) Ltd)?(?: Dashboard Portal)?$/i.test(name)
        ? "The Fixer (Pty) Ltd Dashboard Portal" : name;
    })(),
    fromEmail: pick(draftString("fromEmail") as any, envString("SMTP_FROM_EMAIL") as any, cfg.fromEmail),
    replyTo: pick(draftString("replyTo") as any, envString("SMTP_REPLY_TO") as any, cfg.replyTo),
    defaultTimezone: pick(draftString("defaultTimezone") as any, envString("REPORT_TIMEZONE") as any, cfg.defaultTimezone),
    portalBaseUrl: pick(draftString("portalBaseUrl") as any, envString("PORTAL_BASE_URL") as any, cfg.portalBaseUrl),
    passwordFromEnvironment: Boolean(envString("SMTP_PASSWORD")),
  };
}

export async function publicEmailConfig() {
  const cfg = await getEmailConfig();
  const resolved = withEnv(cfg);
  return {
    emailProvider: resolved.emailProvider,
    resendConfigured: Boolean(resolved.emailProvider === "resend" && resolved.resendApiKey),
    resendFromEmail: resolved.resendFromEmail,
    smtpHost: resolved.smtpHost,
    smtpPort: resolved.smtpPort,
    smtpSecure: resolved.smtpSecure,
    smtpRequireTls: resolved.smtpRequireTls,
    smtpRejectUnauthorized: resolved.smtpRejectUnauthorized,
    smtpUsername: resolved.smtpUsername,
    hasPassword: Boolean(resolved.smtpPassword),
    passwordFromEnvironment: resolved.passwordFromEnvironment,
    fromName: resolved.fromName,
    fromEmail: resolved.fromEmail,
    replyTo: resolved.replyTo,
    defaultTimezone: resolved.defaultTimezone,
    portalBaseUrl: resolved.portalBaseUrl,
    configured: resolved.emailProvider === "resend"
      ? Boolean(resolved.resendApiKey && (resolved.resendFromEmail || resolved.fromEmail))
      : Boolean(resolved.smtpHost && resolved.smtpPort && resolved.fromEmail && (!resolved.smtpUsername || resolved.smtpPassword)),
    lastTestAt: cfg.lastTestAt,
    lastTestStatus: cfg.lastTestStatus,
    lastTestNote: cfg.lastTestNote,
    updatedAt: cfg.updatedAt,
    // automations — not secret, safe to return as-is
    alertEmails: (cfg as any).alertEmails,
    // Webhook URLs are bearer credentials. Never echo them back to the browser.
    hasAlertSlackWebhook: Boolean((cfg as any).alertSlackWebhookUrl),
    digestEnabled: (cfg as any).digestEnabled,
    lastDigestSentAt: (cfg as any).lastDigestSentAt,
    staleDeactivateDays: (cfg as any).staleDeactivateDays,
    lastStaleCheckAt: (cfg as any).lastStaleCheckAt,
    scoreChangeAlertsEnabled: (cfg as any).scoreChangeAlertsEnabled,
    syntheticDataMode: Boolean((cfg as any).syntheticDataMode),
  };
}

export async function saveEmailConfig(input: EmailDraft) {
  const current = await getEmailConfig();
  const data: any = {};
  if ("emailProvider" in input) {
    if (input.emailProvider !== "smtp" && input.emailProvider !== "resend") throw new Error("email provider must be SMTP or Resend");
    data.emailProvider = input.emailProvider;
  }
  if ("resendApiKey" in input && clean(input.resendApiKey)) data.resendApiKey = clean(input.resendApiKey);
  if ("smtpHost" in input) data.smtpHost = clean(input.smtpHost);
  if ("smtpPort" in input && input.smtpPort != null) data.smtpPort = Math.max(1, Math.min(65535, Number(input.smtpPort)));
  if ("smtpSecure" in input) data.smtpSecure = Boolean(input.smtpSecure);
  if ("smtpRequireTls" in input) data.smtpRequireTls = Boolean(input.smtpRequireTls);
  if ("smtpRejectUnauthorized" in input) data.smtpRejectUnauthorized = Boolean(input.smtpRejectUnauthorized);
  if ("smtpUsername" in input) data.smtpUsername = clean(input.smtpUsername);
  if (clean(input.smtpPassword)) data.smtpPassword = clean(input.smtpPassword);
  if ("fromName" in input) data.fromName = clean(input.fromName) || "The Fixer (Pty) Ltd Dashboard Portal";
  if ("fromEmail" in input) data.fromEmail = clean(input.fromEmail);
  if ("resendFromEmail" in input && clean(input.resendFromEmail) &&
      (input.emailProvider ?? current.emailProvider) === "resend") {
    // Prisma SystemEmailConfig has one persisted fromEmail column, not a
    // separate resendFromEmail column. Reuse it for the selected provider.
    data.fromEmail = clean(input.resendFromEmail);
  }
  if ("replyTo" in input) data.replyTo = clean(input.replyTo);
  if ("defaultTimezone" in input) {
    const zone = clean(input.defaultTimezone) || "Africa/Johannesburg";
    if (!DateTime.now().setZone(zone).isValid) throw new Error("default timezone is not a valid IANA timezone");
    data.defaultTimezone = zone;
  }
  if ("portalBaseUrl" in input) {
    const base = clean(input.portalBaseUrl);
    if (base && !safePortalBaseUrl(base)) throw new Error("Portal base URL must be a secure HTTPS origin");
    data.portalBaseUrl = base;
  }
  if ("alertEmails" in input) data.alertEmails = clean(input.alertEmails);
  if ("alertSlackWebhookUrl" in input) {
    const webhook = input.alertSlackWebhookUrl;
    if (webhook == null || webhook === "") data.alertSlackWebhookUrl = null;
    else if (!allowedSlackWebhookUrl(webhook)) throw new Error("Slack webhook must be an HTTPS Slack incoming-webhook URL");
    else data.alertSlackWebhookUrl = webhook;
  }
  if ("digestEnabled" in input) data.digestEnabled = Boolean(input.digestEnabled);
  if ("staleDeactivateDays" in input) {
    const n = input.staleDeactivateDays;
    data.staleDeactivateDays = n == null || Number(n) <= 0 ? null : Math.round(Math.max(7, Math.min(3650, Number(n))));
  }
  if ("scoreChangeAlertsEnabled" in input) data.scoreChangeAlertsEnabled = Boolean(input.scoreChangeAlertsEnabled);
  if ("syntheticDataMode" in input) data.syntheticDataMode = Boolean(input.syntheticDataMode);
  if (data.fromEmail && !emailOk(data.fromEmail)) throw new Error("from email is not valid");
  if (data.replyTo && !emailOk(data.replyTo)) throw new Error("reply-to email is not valid");
  if (data.resendFromEmail && !emailOk(data.resendFromEmail)) throw new Error("Resend From email is not valid");
  if (process.env.NODE_ENV === "production" &&
      ["smtpSecure", "smtpRequireTls", "smtpRejectUnauthorized"].some(key => key in data)) {
    assertSecureSmtpTls(withEnv({ ...current, ...data }));
  }
  await prisma.systemEmailConfig.update({ where: { id: current.id }, data });
  return publicEmailConfig();
}

async function smtpTransport(draft: EmailDraft = {}) {
  const saved = await getEmailConfig();
  const cfg = withEnv(saved, draft);
  assertSecureSmtpTls(cfg);
  if (!cfg.smtpHost) throw new Error("SMTP host is required");
  if (!cfg.smtpPort) throw new Error("SMTP port is required");
  if (!cfg.fromEmail || !emailOk(cfg.fromEmail)) throw new Error("A valid From email is required");
  if (cfg.smtpUsername && !cfg.smtpPassword) throw new Error("SMTP password is required when an SMTP username is supplied");
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: Number(cfg.smtpPort),
    secure: Boolean(cfg.smtpSecure),
    requireTLS: Boolean(cfg.smtpRequireTls),
    auth: cfg.smtpUsername ? { user: cfg.smtpUsername, pass: cfg.smtpPassword } : undefined,
    tls: { rejectUnauthorized: Boolean(cfg.smtpRejectUnauthorized) },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
  return { transporter, cfg };
}

async function sendEmail(opts: { to: string | string[]; subject: string; html: string; replyTo?: string }, draft: EmailDraft = {}) {
  const saved = await getEmailConfig();
  const cfg = withEnv(saved, draft);
  const fromEmail = cfg.resendFromEmail || cfg.fromEmail;
  if (cfg.emailProvider === "resend") {
    if (!cfg.resendApiKey) throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    if (!fromEmail || !emailOk(fromEmail)) throw new Error("A valid Resend From email is required");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${cfg.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${cfg.fromName || "The Fixer (Pty) Ltd Dashboard Portal"} <${fromEmail}>`,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        reply_to: opts.replyTo || cfg.replyTo || undefined,
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!response.ok) {
      // Never capture an untrusted provider response body in an exception:
      // the admin test route persists error messages and exposes them again.
      throw new Error(`Resend request failed (HTTP ${response.status})`);
    }
    return cfg;
  }
  const { transporter } = await smtpTransport(draft);
  await transporter.sendMail({
    from: { name: cfg.fromName || "The Fixer (Pty) Ltd Dashboard Portal", address: cfg.fromEmail! },
    to: opts.to,
    replyTo: opts.replyTo || cfg.replyTo || undefined,
    subject: opts.subject,
    html: opts.html,
  });
  return cfg;
}

// reusable low-level sender — used for scheduled reports AND for one-off
// transactional emails like "set your password" links (see userService.ts).
// Uses the same admin-configured SMTP settings as everything else.
export async function sendMail(opts: { to: string; subject: string; html: string; replyTo?: string }) {
  await sendEmail(opts);
}

export async function portalBaseUrl(): Promise<string | null> {
  const cfg = await publicEmailConfig();
  return safePortalBaseUrl((cfg as any).portalBaseUrl);
}

export async function testEmailConnection(draft: EmailDraft & { recipient?: string | null }) {
  const recipient = clean(draft.recipient);
  if (!recipient || !emailOk(recipient)) throw new Error("Enter a valid test recipient email");
  const now = new Date();
  try {
    const saved = await getEmailConfig();
    const cfg = withEnv(saved, draft);
    if (cfg.emailProvider === "smtp") await (await smtpTransport(draft)).transporter.verify();
    await sendEmail({
      to: recipient,
      subject: "The Fixer (Pty) Ltd Dashboard Portal — email test",
      html: `<div style="font-family:Arial,sans-serif;color:#241536;max-width:620px"><h2 style="color:#32217c">Email delivery is working</h2><p>This test was sent successfully by the <strong>The Fixer (Pty) Ltd Dashboard Portal</strong>.</p><p style="color:#6b7280;font-size:13px">${escapeHtml(now.toISOString())}</p></div>`,
    }, draft);
    await prisma.systemEmailConfig.update({ where: { id: "default" }, data: { lastTestAt: now, lastTestStatus: "SUCCESS", lastTestNote: `Test email sent to ${recipient}` } });
    return { ok: true, recipient };
  } catch (error: unknown) {
    const safeMessage = safeEmailDeliveryFailure(error);
    await prisma.systemEmailConfig.update({ where: { id: "default" }, data: { lastTestAt: now, lastTestStatus: "FAILED", lastTestNote: safeMessage } });
    // The HTTP handler must not expose raw SMTP banners or remote error bodies.
    throw new Error(safeMessage);
  }
}

function parseTime(sendTime: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(sendTime || "");
  if (!match) throw new Error("send time must be HH:MM");
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("send time must be HH:MM");
  return { hour, minute };
}

export function nextRunFor(input: ScheduleInput, after = new Date()): Date {
  const zone = clean(input.timezone) || "Africa/Johannesburg";
  const localNow = DateTime.fromJSDate(after).setZone(zone);
  if (!localNow.isValid) throw new Error("timezone is not valid");
  const { hour, minute } = parseTime(input.sendTime || "08:00");
  let next: DateTime;
  if (input.frequency === "ONCE") {
    const date = clean(input.onceDate);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("send date is required for a one-off report");
    next = DateTime.fromISO(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, { zone });
    if (!next.isValid) throw new Error("send date is invalid");
    if (next <= localNow) throw new Error("send date/time must be in the future");
  } else if (input.frequency === "DAILY") {
    next = localNow.set({ hour, minute, second: 0, millisecond: 0 });
    if (next <= localNow) next = next.plus({ days: 1 });
  } else if (input.frequency === "WEEKLY") {
    const weekday = Number(input.dayOfWeek);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("weekday must be Monday (1) to Sunday (7)");
    const delta = (weekday - localNow.weekday + 7) % 7;
    next = localNow.plus({ days: delta }).set({ hour, minute, second: 0, millisecond: 0 });
    if (next <= localNow) next = next.plus({ days: 7 });
  } else if (input.frequency === "MONTHLY") {
    const wanted = Number(input.dayOfMonth);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > 31) throw new Error("day of month must be between 1 and 31");
    const inMonth = (base: DateTime) => base.set({ day: Math.min(wanted, base.daysInMonth || wanted), hour, minute, second: 0, millisecond: 0 });
    next = inMonth(localNow);
    if (next <= localNow) next = inMonth(localNow.plus({ months: 1 }).startOf("month"));
  } else {
    throw new Error("unsupported report frequency");
  }
  return next.toUTC().toJSDate();
}

function normalizeRecipients(input: unknown, fallbackEmail: string, allowAdditional: boolean): string[] {
  const raw = Array.isArray(input) ? input : [];
  const cleaned = raw.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const recipients = allowAdditional ? cleaned : [fallbackEmail.toLowerCase()];
  if (!recipients.length) recipients.push(fallbackEmail.toLowerCase());
  const unique = [...new Set(recipients)];
  if (unique.length > 10) throw new Error("a report can be sent to a maximum of 10 recipients");
  const invalid = unique.find((email) => !emailOk(email));
  if (invalid) throw new Error("invalid recipient email");
  return unique;
}

function cleanFilters(input: any): ReportFilters {
  const filters: ReportFilters = {};
  if (input?.period) {
    if (!/^\d{4}-\d{2}$/.test(String(input.period))) throw new Error("period must be YYYY-MM");
    filters.period = String(input.period);
  } else {
    const range = ["30d", "quarter", "all"].includes(String(input?.range)) ? String(input.range) as ReportFilters["range"] : "all";
    filters.range = range;
  }
  if (input?.site && input.site !== "all") filters.site = String(input.site);
  if (input?.income && input.income !== "all") filters.income = String(input.income);
  return filters;
}

export async function createReportSchedule(user: any, input: ScheduleInput) {
  const mail = await publicEmailConfig();
  if (!mail.configured) throw new Error("Email delivery is not configured. Ask an administrator to complete System Email Setup first.");
  const employer = await prisma.employer.findUnique({ where: { id: input.employerId }, select: { id: true, name: true } });
  if (!employer) throw new Error("employer not found");
  const canSee = isAdminRole(user) || (user.links || []).some((link: any) => link.employerId === employer.id);
  if (!canSee) throw new Error("you do not have access to this employer");
  const timezone = clean(input.timezone) || mail.defaultTimezone || "Africa/Johannesburg";
  const frequency = String(input.frequency || "").toUpperCase() as ScheduleInput["frequency"];
  if (!["ONCE", "DAILY", "WEEKLY", "MONTHLY"].includes(frequency)) throw new Error("unsupported report frequency");
  const sendTime = input.sendTime || "08:00";
  const normalized: ScheduleInput = { ...input, frequency, timezone, sendTime };
  const nextRunAt = nextRunFor(normalized);
  const recipients = normalizeRecipients(input.recipients, user.email, isAdminRole(user));
  const filters = cleanFilters(input.filters || {});
  return prisma.reportSchedule.create({
    data: {
      userId: user.id,
      employerId: employer.id,
      name: clean(input.name) || `${employer.name} scheduled report`,
      frequency,
      timezone,
      sendTime,
      dayOfWeek: frequency === "WEEKLY" ? Number(input.dayOfWeek) : null,
      dayOfMonth: frequency === "MONTHLY" ? Number(input.dayOfMonth) : null,
      onceDate: frequency === "ONCE" ? DateTime.fromISO(`${input.onceDate}T00:00:00`, { zone: timezone }).toUTC().toJSDate() : null,
      filters: filters as any,
      recipients: recipients as any,
      nextRunAt,
    },
    include: { employer: { select: { id: true, name: true } } },
  });
}

export async function listReportSchedules(user: any, all = false) {
  const where = isAdminRole(user) && all ? {} : { userId: user.id };
  return prisma.reportSchedule.findMany({
    where,
    orderBy: [{ active: "desc" }, { nextRunAt: "asc" }],
    include: {
      employer: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function updateReportSchedule(user: any, id: string, patch: any) {
  const current = await prisma.reportSchedule.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
  if (!current) throw new Error("schedule not found");
  if (!isAdminRole(user) && current.userId !== user.id) throw new Error("you cannot edit this schedule");
  if (patch && Object.keys(patch).length === 1 && typeof patch.active === "boolean") {
    if (patch.active) {
      const owner = await currentReportOwner(current.userId);
      if (!reportDeliveryAllowed(owner, current.employerId, current.recipients))
        throw new Error("Cannot reactivate a report whose owner lacks access or has invalid recipients");
    }
    return prisma.reportSchedule.update({ where: { id }, data: { active: patch.active } });
  }
  throw new Error("To change report filters or frequency, delete the schedule and create a new one.");
}

export async function deleteReportSchedule(user: any, id: string) {
  const current = await prisma.reportSchedule.findUnique({ where: { id } });
  if (!current) return { deleted: true };
  if (!isAdminRole(user) && current.userId !== user.id) throw new Error("you cannot delete this schedule");
  await prisma.reportSchedule.delete({ where: { id } });
  return { deleted: true };
}

function money(value: unknown) {
  if (value == null || value === "") return "—";
  return typeof value === "number" ? `R ${value.toLocaleString("en-ZA")}` : escapeHtml(value);
}

function reportHtml(payload: any, schedule: any, theme: any) {
  const primary = safeEmailColor(theme?.primaryColor, "32217C");
  const accent = safeEmailColor(theme?.accentColor, "B15BE8");
  const label = payload.filterContext?.label || "Programme to date";
  const site = payload.filterContext?.site || "All regions";
  const income = payload.filterContext?.incomeLabel || "All income bands";
  const completed = Array.isArray(payload.outcomes) ? payload.outcomes.reduce((sum: number, row: any) => sum + (Number(row.count) || 0), 0) : 0;
  const outcomeRows = (payload.outcomes || []).map((row: any) => `<tr><td style="padding:9px 8px;border-bottom:1px solid #eee">${escapeHtml(row.name)}</td><td style="padding:9px 8px;border-bottom:1px solid #eee;text-align:right">${Number(row.count || 0).toLocaleString("en-ZA")}</td><td style="padding:9px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${escapeHtml(row.stat)} ${escapeHtml(row.statL)}</td></tr>`).join("");
  const drivers = (payload.wellness?.drivers || []).map((row: any) => `<tr><td style="padding:7px 8px">${escapeHtml(row.name)}</td><td style="padding:7px 8px;text-align:right;font-weight:700">${row.available ? escapeHtml(row.score) : "Data not loaded"}</td></tr>`).join("");
  const warnings = payload.dataQuality?.warnings || [];
  const portalBase = safePortalBaseUrl((schedule as any).portalBaseUrl);
  const portal = portalBase ? `${portalBase.replace(/\/$/, "")}/dashboard?employer=${encodeURIComponent(schedule.employerId)}` : null;
  return `<!doctype html><html><body style="margin:0;background:#f5f4fa;font-family:Arial,Helvetica,sans-serif;color:#241536"><div style="max-width:760px;margin:0 auto;padding:28px 16px">
    <div style="background:${primary};padding:22px 26px;border-radius:16px 16px 0 0;color:white"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#e6dcff;font-weight:700">${escapeHtml(theme?.name || "The Fixer (Pty) Ltd Dashboard Portal")}</div><h1 style="font-size:26px;margin:8px 0 4px">${escapeHtml(payload.employer)} — Financial Wellbeing Report</h1><div style="font-size:13px;color:#e6dcff">${escapeHtml(label)} · ${escapeHtml(site)} · ${escapeHtml(income)}</div></div>
    <div style="background:white;padding:24px 26px;border-radius:0 0 16px 16px;border:1px solid #e8e1f7;border-top:0">
      <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:22px"><tr>
        <td style="padding:12px;background:#f7f4ff;border-radius:10px"><div style="font-size:11px;color:#7c6c8c;text-transform:uppercase;font-weight:700">Wellness score</div><div style="font-size:26px;font-weight:800;color:${primary}">${payload.wellness?.complete && payload.wellness?.score != null ? escapeHtml(payload.wellness.score) + "/100" : "Data incomplete"}</div></td>
        <td width="10"></td><td style="padding:12px;background:#f7f4ff;border-radius:10px"><div style="font-size:11px;color:#7c6c8c;text-transform:uppercase;font-weight:700">Enrolled</div><div style="font-size:26px;font-weight:800;color:${primary}">${payload.kpis?.takeUp?.available ? Number(payload.kpis.takeUp.enrolled || 0).toLocaleString("en-ZA") : "—"}</div></td>
        <td width="10"></td><td style="padding:12px;background:#f7f4ff;border-radius:10px"><div style="font-size:11px;color:#7c6c8c;text-transform:uppercase;font-weight:700">Problems resolved</div><div style="font-size:26px;font-weight:800;color:${primary}">${payload.availability?.journeys ? completed.toLocaleString("en-ZA") : "—"}</div></td>
      </tr></table>
      <h2 style="font-size:17px;color:${primary};margin:0 0 8px">Headline metrics</h2>
      <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;margin-bottom:22px"><tr><td style="padding:8px">Programme take-up</td><td style="padding:8px;text-align:right;font-weight:700">${payload.kpis?.takeUp?.available ? escapeHtml(payload.kpis.takeUp.pct) + "%" : "Data not loaded"}</td></tr><tr><td style="padding:8px">Actively engaged</td><td style="padding:8px;text-align:right;font-weight:700">${payload.kpis?.activated?.available ? escapeHtml(payload.kpis.activated.pct) + "%" : "Data not loaded"}</td></tr><tr><td style="padding:8px">Cash freed up / month</td><td style="padding:8px;text-align:right;font-weight:700">${payload.kpis?.monthlySaving?.available ? money(payload.kpis.monthlySaving.rand) : "Data not loaded"}</td></tr><tr><td style="padding:8px">Average experience rating</td><td style="padding:8px;text-align:right;font-weight:700">${payload.kpis?.avgRating?.available ? escapeHtml(payload.kpis.avgRating.val) + "/5" : "Data not loaded"}</td></tr></table>
      <h2 style="font-size:17px;color:${primary};margin:0 0 8px">Financial problems resolved</h2>
      ${outcomeRows ? `<table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;margin-bottom:22px"><thead><tr><th style="text-align:left;padding:8px;background:#f7f4ff">Outcome</th><th style="text-align:right;padding:8px;background:#f7f4ff">Completed</th><th style="text-align:right;padding:8px;background:#f7f4ff">Value</th></tr></thead><tbody>${outcomeRows}</tbody></table>` : `<p style="color:#7c6c8c">${payload.availability?.journeys ? "No completed outcomes in this reporting window." : "Journey data not loaded."}</p>`}
      <h2 style="font-size:17px;color:${primary};margin:0 0 8px">Financial Wellness drivers</h2><table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;margin-bottom:22px">${drivers}</table>
      ${warnings.length ? `<div style="border-left:4px solid #d49a25;background:#fff8e8;padding:12px 14px;font-size:12px;color:#6b531f"><strong>Data quality:</strong> ${warnings.map(escapeHtml).join(" ")}</div>` : ""}
      <div style="margin-top:22px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#8a7e93">Generated ${escapeHtml(DateTime.now().setZone(schedule.timezone || "Africa/Johannesburg").toFormat("dd LLL yyyy HH:mm ZZZZ"))}. This is an aggregated employer report; individual employee financial information is not included.</div>
      ${portal ? `<div style="margin-top:14px"><a href="${escapeHtml(portal)}" style="display:inline-block;background:${accent};color:white;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700;font-size:12px">Open Dashboard Portal</a></div>` : ""}
    </div></div></body></html>`;
}

async function assertDashboardPublishable() {
  const state = await prisma.integrationConfig.findUnique({
    where: { id: "default" },
    select: { lastSyncStatus: true },
  });
  if (["REBUILDING", "PARTIAL", "FAILED", "FULL_REFRESH_FAILED", "FULL_REFRESH_PRECHECK_FAILED"].includes(String(state?.lastSyncStatus || ""))) {
    // The free-text sync note can contain upstream database/HTTP diagnostics.
    // Do not reflect it into report delivery responses or error logs.
    throw new Error("Dashboard source is not ready; report delivery is deferred until a successful sync.");
  }
  return state;
}

const REPORT_DELIVERY_BLOCKED = "Report delivery blocked: owner access or recipient settings have changed.";

async function currentReportOwner(userId: string) {
  // A stored schedule is not an authorization grant. Always re-read current
  // active status, role and employer links, including after a role downgrade.
  return prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, role: true, email: true, links: { select: { employerId: true } } },
  });
}

async function assertScheduleDeliveryAuthorized(
  schedule: { id: string; userId: string; employerId: string; recipients: unknown },
  triggeredBy: "scheduled" | "manual",
) {
  const owner = await currentReportOwner(schedule.userId);
  if (reportDeliveryAllowed(owner, schedule.employerId, schedule.recipients)) return;
  // Pause permanently rather than repeatedly attempting an unauthorized
  // delivery. Do not persist old external recipients in the blocked audit row.
  try {
    await prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: { active: false, lastStatus: "BLOCKED", lastError: REPORT_DELIVERY_BLOCKED },
    });
  } catch {
    // A failed pause must not expose DB diagnostics or allow a send.
    throw new Error(REPORT_DELIVERY_BLOCKED);
  }
  try {
    await prisma.reportDeliveryLog.create({
      data: { scheduleId: schedule.id, triggeredBy, status: "BLOCKED", recipients: [], error: REPORT_DELIVERY_BLOCKED },
    });
  } catch {
    // Keep the schedule paused even when the audit store is unavailable.
  }
  throw new Error(REPORT_DELIVERY_BLOCKED);
}

async function assertScheduledReportStillActive(scheduleId: string): Promise<void> {
  // A user can pause a schedule while dashboard generation is running.
  // The claimed next-run timestamp is not permission to deliver anyway.
  const current = await prisma.reportSchedule.findUnique({
    where: { id: scheduleId },
    select: { active: true },
  });
  if (current?.active !== true)
    throw new Error("Report schedule was paused or deleted before delivery.");
}

async function sendSchedule(scheduleId: string, triggeredBy: "scheduled" | "manual") {
  const schedule = await prisma.reportSchedule.findUnique({
    where: { id: scheduleId },
    include: { employer: { select: { id: true, name: true } }, user: { select: { id: true, email: true, name: true } } },
  });
  if (!schedule) throw new Error("schedule not found");
  if (triggeredBy === "scheduled") await assertScheduledReportStillActive(schedule.id);
  await assertScheduleDeliveryAuthorized(schedule, triggeredBy);
  await assertDashboardPublishable();
  const filters = (schedule.filters || {}) as ReportFilters;
  const payload = await getDashboardPayload(schedule.employerId, filters as any);
  const theme = await themeForEmployer(schedule.employerId);
  const saved = await getEmailConfig();
  const cfg = withEnv(saved);
  const recipients = (Array.isArray(schedule.recipients) ? schedule.recipients : [schedule.user.email]).map(String);
  const subject = notificationPlainText(`${schedule.employer.name} — ${payload.filterContext?.label || "Financial Wellbeing Report"}`);
  const html = reportHtml(payload, { ...schedule, portalBaseUrl: cfg.portalBaseUrl }, theme);
  // A dashboard refresh can take time. Recheck immediately before external
  // delivery so role changes during report generation cannot go unnoticed.
  await assertScheduleDeliveryAuthorized(schedule, triggeredBy);
  if (triggeredBy === "scheduled") await assertScheduledReportStillActive(schedule.id);
  // Only transport failures are eligible for a retry. Once the provider
  // accepts the email, a later database/audit failure must never resend it.
  try {
    await sendEmail({ to: recipients, subject, html });
  } catch (error: unknown) {
    // Delivery records may be visible to report owners. Persist only safe,
    // classified errors, never raw provider responses or SMTP banners.
    const message = safeEmailDeliveryFailure(error);
    const failed = schedule.consecutiveFailures + 1;
    // Only an automatic scheduled delivery may move the persisted next-run time
    // into the retry window. A user clicking “Send now” must never alter the
    // schedule they originally configured.
    const retry = triggeredBy === "scheduled" && failed <= 3 ? new Date(Date.now() + 30 * 60 * 1000) : undefined;
    try {
      await prisma.reportDeliveryLog.create({ data: { scheduleId: schedule.id, triggeredBy, status: "FAILED", recipients: recipients as any, subject, filters: filters as any, error: message } });
    } catch {
      // The transport has already failed. Try the schedule update regardless.
    }
    try {
      if (triggeredBy === "scheduled") {
        // Do not reactivate a schedule the owner paused during an in-flight
        // transport attempt. The database predicate is checked atomically.
        await prisma.reportSchedule.updateMany({
          where: { id: schedule.id, active: true },
          data: { lastStatus: "FAILED", lastError: message, consecutiveFailures: failed, ...(retry ? { nextRunAt: retry } : {}) },
        });
      } else {
        await prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: { lastStatus: "FAILED", lastError: message, consecutiveFailures: failed },
        });
      }
    } catch {
      throw new Error("Email delivery failed; retry status could not be persisted");
    }
    throw new Error(message);
  }
  let trackingWarning = false;
  try {
    await prisma.reportDeliveryLog.create({ data: { scheduleId: schedule.id, triggeredBy, status: "SENT", recipients: recipients as any, subject, filters: filters as any } });
  } catch { trackingWarning = true; }
  try {
    await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastSentAt: new Date(), lastStatus: "SENT", lastError: null, consecutiveFailures: 0, ...(triggeredBy === "scheduled" && schedule.frequency === "ONCE" ? { active: false } : {}) } });
  } catch { trackingWarning = true; }
  if (trackingWarning) {
    // Do not log raw DB exceptions or mark a successfully sent email as FAILED.
    console.error("Report email accepted but delivery tracking could not be fully persisted", { scheduleId: schedule.id });
  }
  return { ok: true, subject, recipients, trackingWarning };
}

export async function sendReportNow(user: any, id: string) {
  const schedule = await prisma.reportSchedule.findUnique({ where: { id } });
  if (!schedule) throw new Error("schedule not found");
  if (!isAdminRole(user) && schedule.userId !== user.id) throw new Error("you cannot send this schedule");
  return sendSchedule(id, "manual");
}

export async function recentReportDeliveries(limit = 20) {
  return prisma.reportDeliveryLog.findMany({ orderBy: { sentAt: "desc" }, take: Math.max(1, Math.min(100, limit)), include: { schedule: { select: { name: true, employer: { select: { name: true } }, user: { select: { name: true, email: true } } } } } });
}

export async function runDueReports(logger?: { info?: Function; error?: Function }) {
  const refresh = await prisma.integrationConfig.findUnique({
    where: { id: "default" },
    select: { lastSyncStatus: true },
  });
  if (["REBUILDING", "PARTIAL", "FAILED", "FULL_REFRESH_FAILED", "FULL_REFRESH_PRECHECK_FAILED"].includes(String(refresh?.lastSyncStatus || ""))) {
    logger?.info?.({ refreshStatus: refresh?.lastSyncStatus }, "scheduled reports deferred until dashboard data is publishable");
    return { checked: 0, deferred: true, refreshStatus: refresh?.lastSyncStatus };
  }
  const now = new Date();
  const due = await prisma.reportSchedule.findMany({ where: { active: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 25 });
  for (const row of due) {
    try {
      const onceDate = row.onceDate ? DateTime.fromJSDate(row.onceDate).setZone(row.timezone).toISODate() : null;
      const input: ScheduleInput = { employerId: row.employerId, frequency: row.frequency as ScheduleInput["frequency"], timezone: row.timezone, sendTime: row.sendTime, dayOfWeek: row.dayOfWeek, dayOfMonth: row.dayOfMonth, onceDate };
      const next = row.frequency === "ONCE" ? new Date(now.getTime() + 3650 * 864e5) : nextRunFor(input, new Date(now.getTime() + 1000));
      const claim = await prisma.reportSchedule.updateMany({
        where: { id: row.id, active: true, nextRunAt: { lte: now } },
        // Keep ONCE active until its send is accepted, so a concurrent user
        // pause can be enforced by the final pre-delivery check.
        data: { lastRunAt: now, nextRunAt: next },
      });
      if (!claim.count) continue;
      logger?.info?.({ scheduleId: row.id, name: row.name }, "sending scheduled report");
      await sendSchedule(row.id, "scheduled");
    } catch (error) {
      logger?.error?.({ err: error, scheduleId: row.id }, "scheduled report failed");
    }
  }
  return { checked: due.length };
}

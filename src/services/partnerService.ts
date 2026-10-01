// ─────────────────────────────────────────────────────────────────────────
// Channel partners (white-label). Admins create partners, set their branding,
// and assign users + employers to them. A user's theme = their partner's theme.
// ─────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// empower-fin is the default portal brand. Channel partners override these values for their assigned users.
export const DEFAULT_THEME = {
  name: "empower-fin Dashboard Portal",
  primaryColor: "32217C",
  accentColor: "B15BE8",
  navyColor: "330A36",
  logoDataUrl: null as string | null,
  tagline: null as string | null,
};

export async function listPartners() {
  return prisma.partner.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, slug: true, displayName: true,
      primaryColor: true, accentColor: true, navyColor: true,
      tagline: true, active: true, logoDataUrl: true,
      brandEngineVersion: true, brandDetectionStatus: true, brandDetectionConfidence: true,
      brandDetectionWarnings: true, brandDetectionDiagnostics: true, brandDetectedPalette: true, brandDetectedAt: true,
      _count: { select: { users: true, employers: true } },
    },
  });
}

export async function createPartner(input: { name: string; displayName?: string }) {
  if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) throw new Error("name is required (max 120 characters)");
  if (input.displayName != null && (typeof input.displayName !== "string" || input.displayName.length > 120)) throw new Error("displayName is invalid or too long");
  input = { ...input, name: input.name.trim() };
  const base = slugify(input.name);
  let slug = base || "partner";
  let n = 1;
  while (await prisma.partner.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
  return prisma.partner.create({ data: { name: input.name, slug, displayName: input.displayName || input.name } });
}

export async function updatePartner(id: string, patch: any) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("invalid partner update");
  const data: any = {};
  for (const k of ["name", "displayName", "primaryColor", "accentColor", "navyColor", "logoDataUrl", "tagline", "active", "brandEngineVersion", "brandDetectionStatus", "brandDetectionConfidence", "brandDetectionWarnings", "brandDetectionDiagnostics", "brandDetectedPalette"]) {
    if (k in patch) data[k] = patch[k] === "" ? null : patch[k];
  }
  for (const k of ["name", "displayName", "tagline"]) {
    if (data[k] != null && (typeof data[k] !== "string" || data[k].length > (k === "tagline" ? 240 : 120))) {
      throw new Error(`${k} is invalid or too long`);
    }
  }
  if (data.active != null && typeof data.active !== "boolean") throw new Error("active must be true or false");
  if (data.brandEngineVersion != null && (typeof data.brandEngineVersion !== "string" || data.brandEngineVersion.length > 40)) throw new Error("brand engine version is invalid");
  if (data.brandDetectionStatus != null && !["AUTO_ACCEPTED","NEEDS_REVIEW","MANUAL","UNREVIEWED"].includes(String(data.brandDetectionStatus))) throw new Error("brand detection status is invalid");
  if (data.brandDetectionConfidence != null) {
    const n=Number(data.brandDetectionConfidence);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error("brand detection confidence must be between 0 and 1");
    data.brandDetectionConfidence=n;
  }
  if (data.brandDetectionWarnings != null && !Array.isArray(data.brandDetectionWarnings)) throw new Error("brandDetectionWarnings must be an array");
  if (data.brandDetectionDiagnostics != null && (typeof data.brandDetectionDiagnostics !== "object" || Array.isArray(data.brandDetectionDiagnostics))) throw new Error("brandDetectionDiagnostics must be an object");
  if (data.brandDetectedPalette != null && !Array.isArray(data.brandDetectedPalette)) throw new Error("brandDetectedPalette must be an array");
  if (data.brandDetectionConfidence != null || data.brandEngineVersion != null || data.brandDetectionWarnings != null) data.brandDetectedAt = new Date();
  // Normalise colours and reject CSS/control-character injection before values
  // can reach inline styles in the browser or generated report HTML.
  for (const c of ["primaryColor", "accentColor", "navyColor"]) {
    if (data[c] != null) {
      if (typeof data[c] !== "string" || !/^#?[0-9a-fA-F]{6}$/.test(data[c])) throw new Error(`${c} must be a six-digit hexadecimal colour`);
      data[c] = data[c].replace(/^#/, "").toUpperCase();
    }
  }
  if (data.logoDataUrl != null) {
    if (typeof data.logoDataUrl !== "string" || data.logoDataUrl.length > 1_500_000 || !/^data:image\/(?:png|jpe?g|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(data.logoDataUrl)) {
      throw new Error("logoDataUrl must be a base64 PNG, JPEG, WebP or SVG image no larger than 1.5 MB");
    }
  }
  return prisma.partner.update({ where: { id }, data });
}

export async function deletePartner(id: string) {
  // unlink users/employers first (don't delete them), then remove the partner
  await prisma.user.updateMany({ where: { partnerId: id }, data: { partnerId: null } });
  await prisma.employer.updateMany({ where: { partnerId: id }, data: { partnerId: null } });
  await prisma.partner.delete({ where: { id } });
  return { deleted: true };
}

export async function assignUserToPartner(userId: string, partnerId: string | null) {
  return prisma.user.update({ where: { id: userId }, data: { partnerId } });
}

export async function assignEmployerToPartner(employerId: string, partnerId: string | null) {
  return prisma.employer.update({ where: { id: employerId }, data: { partnerId } });
}

// resolve the theme that should apply for a given user
export async function themeForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { partner: true } });
  const p = user?.partner;
  if (!p || !p.active) return { ...DEFAULT_THEME };
  return {
    name: p.displayName || p.name || DEFAULT_THEME.name,
    primaryColor: p.primaryColor || DEFAULT_THEME.primaryColor,
    accentColor: p.accentColor || DEFAULT_THEME.accentColor,
    navyColor: p.navyColor || DEFAULT_THEME.navyColor,
    logoDataUrl: p.logoDataUrl || null,
    tagline: p.tagline || null,
  };
}

// Resolve branding from the employer itself. Scheduled reports should use the
// channel-partner brand assigned to the employer rather than whichever admin
// happened to create the schedule.
export async function themeForEmployer(employerId: string) {
  const employer = await prisma.employer.findUnique({ where: { id: employerId }, include: { partner: true } });
  const p = employer?.partner;
  if (!p || !p.active) return { ...DEFAULT_THEME };
  return {
    name: p.displayName || p.name || DEFAULT_THEME.name,
    primaryColor: p.primaryColor || DEFAULT_THEME.primaryColor,
    accentColor: p.accentColor || DEFAULT_THEME.accentColor,
    navyColor: p.navyColor || DEFAULT_THEME.navyColor,
    logoDataUrl: p.logoDataUrl || null,
    tagline: p.tagline || null,
  };
}

// theme by partner slug (for the future branded login page)
export async function themeForSlug(slug: string) {
  const p = await prisma.partner.findUnique({ where: { slug } });
  if (!p || !p.active) return { ...DEFAULT_THEME };
  return {
    name: p.displayName || p.name,
    primaryColor: p.primaryColor || DEFAULT_THEME.primaryColor,
    accentColor: p.accentColor || DEFAULT_THEME.accentColor,
    navyColor: p.navyColor || DEFAULT_THEME.navyColor,
    logoDataUrl: p.logoDataUrl || null,
    tagline: p.tagline || null,
  };
}

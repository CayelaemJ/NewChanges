import { randomUUID } from "node:crypto";
import { prisma } from "./authService.js";

const DUE_DAYS = 30;

function dueDate(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + DUE_DAYS);
  return d;
}

export async function complianceOverview() {
  const now = new Date();
  const [activities, vendors, retention, requests, incidents, overdueRequests, crossBorder] = await Promise.all([
    prisma.processingActivity.count({ where: { active: true } }),
    prisma.complianceVendor.count({ where: { approved: true } }),
    prisma.retentionPolicy.count({ where: { active: true } }),
    prisma.dataSubjectRequest.count({ where: { status: { notIn: ["FULFILLED", "PARTIALLY_FULFILLED", "REFUSED", "CLOSED"] } } }),
    prisma.securityIncident.count({ where: { status: { not: "RESOLVED" } } }),
    prisma.dataSubjectRequest.count({
      where: { dueAt: { lt: now }, status: { notIn: ["FULFILLED", "PARTIALLY_FULFILLED", "REFUSED", "CLOSED"] } }
    }),
    prisma.processingActivity.count({ where: { active: true, crossBorder: true } }),
  ]);
  const missing = await prisma.processingActivity.count({
    where: { active: true, OR: [{ piaStatus: "REQUIRED" }, { partyRole: "OPERATOR", operatorAgreementRef: null }] }
  });
  return {
    status: missing || overdueRequests || incidents ? "ACTION_REQUIRED" : "MONITORED",
    processingActivities: activities,
    approvedVendors: vendors,
    retentionPolicies: retention,
    openDataSubjectRequests: requests,
    overdueDataSubjectRequests: overdueRequests,
    openSecurityIncidents: incidents,
    crossBorderActivities: crossBorder,
    governanceGaps: missing,
    checkedAt: now.toISOString(),
  };
}

export async function listProcessingActivities(limit = 100) {
  return prisma.processingActivity.findMany({ orderBy: [{ active: "desc" }, { updatedAt: "desc" }], take: Math.min(limit, 250) });
}

export async function createProcessingActivity(input: Record<string, unknown>) {
  const name = String(input.name ?? "").trim().slice(0, 180);
  const purpose = String(input.purpose ?? "").trim().slice(0, 1000);
  const dataSubjects = String(input.dataSubjects ?? "").trim().slice(0, 500);
  const dataCategories = String(input.dataCategories ?? "").trim().slice(0, 1000);
  const lawfulBasis = String(input.lawfulBasis ?? "").trim().slice(0, 200);
  const partyRole = String(input.partyRole ?? "").trim();
  if (!name || !purpose || !dataSubjects || !dataCategories || !lawfulBasis) throw new Error("name, purpose, data subjects, data categories and lawful basis are required");
  if (!["RESPONSIBLE_PARTY", "CO_RESPONSIBLE_PARTY", "OPERATOR"].includes(partyRole)) throw new Error("invalid party role");
  const crossBorder = Boolean(input.crossBorder);
  if (crossBorder && !String(input.crossBorderBasis ?? "").trim()) throw new Error("cross-border processing requires a documented transfer basis");
  if (partyRole === "OPERATOR" && !String(input.operatorAgreementRef ?? "").trim()) throw new Error("operator processing requires an operator agreement reference");
  return prisma.processingActivity.create({
    data: {
      id: randomUUID(), name, description: String(input.description ?? "").slice(0, 1500),
      purpose, lawfulBasis, partyRole: partyRole as any, dataSubjects, dataCategories,
      specialPersonalInfo: Boolean(input.specialPersonalInfo), childrenData: Boolean(input.childrenData),
      automatedDecision: Boolean(input.automatedDecision), profiling: Boolean(input.profiling),
      recipients: String(input.recipients ?? "").slice(0, 1000), source: String(input.source ?? "").slice(0, 500),
      retentionPolicy: String(input.retentionPolicy ?? "").slice(0, 500),
      crossBorder, crossBorderBasis: crossBorder ? String(input.crossBorderBasis ?? "").slice(0, 1000) : null,
      operatorAgreementRef: partyRole === "OPERATOR" ? String(input.operatorAgreementRef ?? "").slice(0, 500) : null,
      piaStatus: String(input.piaStatus ?? (Boolean(input.specialPersonalInfo) || Boolean(input.childrenData) || crossBorder ? "REQUIRED" : "REVIEWED")).slice(0, 80),
      owner: String(input.owner ?? "").slice(0, 254),
      active: input.active === false ? false : true,
      reviewedAt: input.reviewedAt ? new Date(String(input.reviewedAt)) : null,
      nextReviewAt: input.nextReviewAt ? new Date(String(input.nextReviewAt)) : null,
    }
  });
}

export async function listDataSubjectRequests(limit = 100) {
  return prisma.dataSubjectRequest.findMany({
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: Math.min(limit, 250),
    include: { employer: { select: { id: true, name: true } } }
  });
}

export async function createDataSubjectRequest(input: Record<string, unknown>) {
  const requesterEmail = String(input.requesterEmail ?? "").trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(requesterEmail)) throw new Error("valid requester email is required");
  const requestType = String(input.requestType ?? "OTHER");
  if (!["ACCESS", "CORRECTION", "DELETION", "OBJECTION", "CONSENT_WITHDRAWAL", "OTHER"].includes(requestType)) throw new Error("invalid request type");
  const receivedAt = input.receivedAt ? new Date(String(input.receivedAt)) : new Date();
  return prisma.dataSubjectRequest.create({
    data: {
      id: randomUUID(), requestType: requestType as any, requesterEmail,
      requesterName: String(input.requesterName ?? "").slice(0, 180),
      employerId: input.employerId ? String(input.employerId) : null,
      description: String(input.description ?? "").slice(0, 3000),
      status: "RECEIVED", identityVerified: false, receivedAt, dueAt: dueDate(receivedAt),
      assignedTo: String(input.assignedTo ?? "").slice(0, 254)
    }
  });
}

export async function updateDataSubjectRequest(id: string, input: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (input.status) data.status = String(input.status);
  if (input.identityVerified === true) { data.identityVerified = true; data.identityVerifiedAt = new Date(); }
  if (input.assignedTo !== undefined) data.assignedTo = String(input.assignedTo ?? "").slice(0, 254);
  if (input.resolutionNotes !== undefined) data.resolutionNotes = String(input.resolutionNotes ?? "").slice(0, 5000);
  if (["FULFILLED","PARTIALLY_FULFILLED","REFUSED","CLOSED"].includes(String(input.status))) data.resolvedAt = new Date();
  return prisma.dataSubjectRequest.update({ where: { id }, data });
}

export async function listComplianceVendors(limit = 100) {
  return prisma.complianceVendor.findMany({ orderBy: [{ approved: "desc" }, { updatedAt: "desc" }], take: Math.min(limit, 250) });
}

export async function createComplianceVendor(input: Record<string, unknown>) {
  const name = String(input.name ?? "").trim().slice(0, 180);
  const service = String(input.service ?? "").trim().slice(0, 500);
  const purpose = String(input.processingPurpose ?? "").trim().slice(0, 1000);
  const categories = String(input.dataCategories ?? "").trim().slice(0, 1000);
  const country = String(input.country ?? "").trim().slice(0, 120);
  if (!name || !service || !purpose || !categories || !country) throw new Error("vendor, service, processing purpose, data categories and country are required");
  const crossBorder = Boolean(input.crossBorder);
  if (crossBorder && !String(input.transferBasis ?? "").trim()) throw new Error("cross-border vendor processing requires a documented transfer basis");
  return prisma.complianceVendor.create({
    data: {
      id: randomUUID(), name, service, processingPurpose: purpose, dataCategories: categories, country,
      crossBorder, transferBasis: crossBorder ? String(input.transferBasis ?? "").slice(0, 1000) : null,
      operatorAgreement: Boolean(input.operatorAgreement), securityReview: Boolean(input.securityReview),
      subprocessorsKnown: Boolean(input.subprocessorsKnown), approved: Boolean(input.approved),
      reviewNotes: String(input.reviewNotes ?? "").slice(0, 3000),
      lastReviewedAt: input.lastReviewedAt ? new Date(String(input.lastReviewedAt)) : null,
      nextReviewAt: input.nextReviewAt ? new Date(String(input.nextReviewAt)) : null,
    }
  });
}

export async function listRetentionPolicies(limit = 100) {
  return prisma.retentionPolicy.findMany({ orderBy: [{ active: "desc" }, { dataClass: "asc" }], take: Math.min(limit, 250) });
}

export async function createRetentionPolicy(input: Record<string, unknown>) {
  const dataClass = String(input.dataClass ?? "").trim().slice(0, 180);
  const purpose = String(input.purpose ?? "").trim().slice(0, 1000);
  const rule = String(input.retentionRule ?? "").trim().slice(0, 1000);
  const deletion = String(input.deletionMethod ?? "").trim().slice(0, 500);
  if (!dataClass || !purpose || !rule || !deletion) throw new Error("data class, purpose, retention rule and deletion method are required");
  const retentionDays = input.retentionDays == null || input.retentionDays === "" ? null : Number(input.retentionDays);
  if (retentionDays != null && (!Number.isInteger(retentionDays) || retentionDays < 1)) throw new Error("retention days must be a positive integer");
  return prisma.retentionPolicy.upsert({
    where: { dataClass },
    update: { purpose, retentionDays, retentionRule: rule, deletionMethod: deletion, legalBasis: String(input.legalBasis ?? "").slice(0, 500), legalHold: Boolean(input.legalHold), active: input.active === false ? false : true, reviewedAt: new Date(), nextReviewAt: input.nextReviewAt ? new Date(String(input.nextReviewAt)) : null },
    create: { id: randomUUID(), dataClass, purpose, retentionDays, retentionRule: rule, deletionMethod: deletion, legalBasis: String(input.legalBasis ?? "").slice(0, 500), legalHold: Boolean(input.legalHold), active: input.active === false ? false : true, reviewedAt: new Date(), nextReviewAt: input.nextReviewAt ? new Date(String(input.nextReviewAt)) : null }
  });
}

export async function listSecurityIncidents(limit = 100) {
  return prisma.securityIncident.findMany({ orderBy: [{ status: "asc" }, { discoveredAt: "desc" }], take: Math.min(limit, 250) });
}

export async function createSecurityIncident(input: Record<string, unknown>) {
  const title = String(input.title ?? "").trim().slice(0, 250);
  const description = String(input.description ?? "").trim().slice(0, 5000);
  if (!title || !description) throw new Error("incident title and description are required");
  return prisma.securityIncident.create({
    data: {
      id: randomUUID(), title, description,
      status: "DETECTED", severity: String(input.severity ?? "HIGH") as any,
      responsibleParty: String(input.responsibleParty ?? "").slice(0, 254),
      informationOfficer: String(input.informationOfficer ?? "").slice(0, 254),
      affectedDataClasses: String(input.affectedDataClasses ?? "").slice(0, 1000),
      affectedSubjectsCount: input.affectedSubjectsCount == null ? null : Number(input.affectedSubjectsCount),
      assignedTo: String(input.assignedTo ?? "").slice(0, 254),
    }
  });
}

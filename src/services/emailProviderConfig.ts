// Merge saved notification provider settings with explicit environment and
// temporary test-email overrides. Persisted keys remain server-only.
export type EmailProvider = "smtp" | "resend";
type StoredProviderSettings = {
  emailProvider?: string | null;
  resendApiKey?: string | null;
  resendFromEmail?: string | null;
};
type ProviderDraft = {
  emailProvider?: EmailProvider;
  resendApiKey?: string | null;
  resendFromEmail?: string | null;
};
type ProviderEnvironment = {
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
};
const nonempty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function resolveEmailProviderConfig(
  stored: StoredProviderSettings,
  draft: ProviderDraft = {},
  env: ProviderEnvironment = process.env,
) {
  const configuredProvider = nonempty(env.EMAIL_PROVIDER)?.toLowerCase();
  if (configuredProvider && configuredProvider !== "smtp" && configuredProvider !== "resend")
    throw new Error("EMAIL_PROVIDER must be smtp or resend");
  const savedProvider = stored.emailProvider === "resend" ? "resend" : "smtp";
  const emailProvider: EmailProvider = draft.emailProvider ??
    (configuredProvider as EmailProvider | undefined) ?? savedProvider;
  const resendApiKey = nonempty(draft.resendApiKey) ??
    nonempty(env.RESEND_API_KEY) ?? nonempty(stored.resendApiKey);
  const resendFromEmail = draft.resendFromEmail !== undefined
    ? nonempty(draft.resendFromEmail)
    : nonempty(env.RESEND_FROM_EMAIL) ?? nonempty(stored.resendFromEmail);
  return { emailProvider, resendApiKey, resendFromEmail };
}

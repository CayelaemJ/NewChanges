// Source credentials must not traverse cleartext SQL transports in production,
// and a TLS handshake without certificate authentication is not sufficient.
// Applies equally to primary source readers and their configured replicas.
export function assertSecureSourceSqlTransport(
  sslEnabled: boolean,
  trustServerCertificate: boolean,
  label: string,
  environment: string | undefined = process.env.NODE_ENV,
): void {
  if (environment !== "production") return;
  if (!sslEnabled)
    throw new Error(`${label} requires encrypted SQL transport in production`);
  if (trustServerCertificate)
    throw new Error(`${label} requires trusted server certificate verification in production`);
}

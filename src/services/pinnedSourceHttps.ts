// Source API HTTPS connections must use the exact DNS answers checked by the
// SSRF policy. Separate pre-flight DNS + global fetch is vulnerable to rebinding.
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { readSourceJson } from "./boundedSourceJson.js";
import { isBlockedSourceAddress } from "./sourceAddressPolicy.js";

export type SourceDnsAnswer = { address: string; family: 4 | 6 };
export type SourceDnsResolver = (hostname: string, options: { all: true }) => Promise<SourceDnsAnswer[]>;

export async function resolvePublicSourceAddresses(
  hostname: string,
  resolver: SourceDnsResolver = dnsLookup as SourceDnsResolver,
): Promise<SourceDnsAnswer[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(host);
  const answers: SourceDnsAnswer[] = literalFamily
    ? [{ address: host, family: literalFamily as 4 | 6 }]
    : await resolver(host, { all: true });
  if (!answers.length || answers.some(item =>
    !item || (item.family !== 4 && item.family !== 6) ||
    isIP(item.address) !== item.family ||
    isBlockedSourceAddress(item.address)
  )) {
    throw new Error("Source API DNS returned a non-public or invalid destination");
  }
  return answers;
}

export function pinnedSourceLookup(expectedHostname: string, answers: readonly SourceDnsAnswer[]) {
  // Node's TLS connection must never resolve the hostname for a second time.
  // HTTPS still authenticates the original hostname via SNI/cert verification.
  return (hostname: string, options: any, callback: (...args: any[]) => void): void => {
    if (hostname !== expectedHostname) {
      callback(new Error("Source API connection attempted an unexpected hostname"));
      return;
    }
    const family = typeof options === "number" ? options : options?.family;
    const matching = answers.filter(a => !family || family === a.family);
    if (!matching.length) {
      callback(new Error("No verified source API address matches the requested family"));
      return;
    }
    if (options?.all) callback(null, matching.map(a => ({ ...a })));
    else callback(null, matching[0].address, matching[0].family);
  };
}

export async function readPinnedSourceApiJson(
  url: URL,
  bearerToken: string | null,
  timeoutMs = 60_000,
): Promise<unknown> {
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("Source API requires a credential-free HTTPS URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const answers = await resolvePublicSourceAddresses(hostname);
  return new Promise<unknown>((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "GET",
      agent: false,
      lookup: pinnedSourceLookup(hostname, answers),
      rejectUnauthorized: true,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
    }, async response => {
      try {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300)
          throw new Error(`Source API returned HTTP ${response.statusCode ?? "unknown"}`);
        // Do not silently decode unbounded compressed responses. The source API
        // contract uses plain bounded JSON pages.
        if (response.headers["content-encoding"] &&
            response.headers["content-encoding"] !== "identity")
          throw new Error("Source API returned unsupported compressed content");
        const headers = new Headers();
        const length = response.headers["content-length"];
        if (typeof length === "string") headers.set("content-length", length);
        const body = Readable.toWeb(response) as ReadableStream<Uint8Array>;
        resolve(await readSourceJson(new Response(body, { headers })));
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    req.on("error", reject);
    req.end();
  });
}

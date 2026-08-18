import { encodeComponent, urlWithParams } from "./syncUrlParams";
import type { Body, KeyValue, RestRequest, WireBody, WirePart, WireRequest } from "./types";

/**
 * The state of the request pane, turned into the one thing Rust is given.
 *
 * Everything Rust would otherwise have to decide is decided here, where it can be tested without
 * a server: which URL, which headers, how a form is encoded, what content type to declare.
 *
 * Phase 4 puts `interpolate` in front of this. Until then `{{var}}` reaches the wire as text.
 */

export interface SendSettings {
  timeoutMs: number;
  followRedirects: boolean;
  acceptInvalidCerts: boolean;
}

/** Until the Settings pane exists in Phase 5. The contract already carries all three, so Phase 5
 *  changes where they come from and nothing else. */
export const PHASE_ONE_SETTINGS: SendSettings = {
  timeoutMs: 30_000,
  followRedirects: true,
  acceptInvalidCerts: false,
};

const CONTENT_TYPE = "content-type";

const RAW_TYPES = {
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  text: "text/plain",
} as const;

/** The rows that are actually sent: ticked, and with something in the key. */
function live<T extends KeyValue>(rows: T[]): T[] {
  return rows.filter((row) => row.enabled && row.key !== "");
}

/** The body on the wire, and the content type it implies — null where the body implies none, or
 *  where reqwest writes the header itself. */
function wireBody(body: Body): { body: WireBody; contentType: string | null } {
  switch (body.kind) {
    case "none":
      return { body: { kind: "none" }, contentType: null };
    case "raw":
      return { body: { kind: "text", text: body.text }, contentType: RAW_TYPES[body.language] };
    case "form":
      return {
        body: {
          kind: "text",
          text: live(body.fields)
            .map((field) => `${encodeComponent(field.key)}=${encodeComponent(field.value)}`)
            .join("&"),
        },
        contentType: "application/x-www-form-urlencoded",
      };
    case "multipart": {
      const parts: WirePart[] = live(body.fields).map((field) => ({
        name: field.key,
        value: field.file === undefined ? field.value : null,
        path: field.file ?? null,
      }));
      // No content type: the boundary is reqwest's to generate and to announce.
      return { body: { kind: "multipart", parts }, contentType: null };
    }
    case "binary":
      // No default type either — a file's type is the user's to declare, and guessing it from an
      // extension would be wrong at exactly the moment it mattered.
      return { body: { kind: "file", path: body.filePath }, contentType: null };
  }
}

/** Everything Rust needs and nothing it has to work out. `requestId` is minted per send, not per
 *  request: sending the same request twice gives two things to cancel. */
export function buildRequest(
  request: RestRequest,
  requestId: string,
  settings: SendSettings,
): WireRequest {
  const { body, contentType } = wireBody(request.body);
  const headers: [string, string][] = live(request.headers).map((row) => [row.key, row.value]);
  const declared = headers.some(([key]) => key.toLowerCase() === CONTENT_TYPE);
  if (contentType !== null && !declared) headers.push(["Content-Type", contentType]);

  return {
    request_id: requestId,
    method: request.method,
    url: urlWithParams(request.url, request.params),
    headers,
    body,
    timeout_ms: settings.timeoutMs,
    follow_redirects: settings.followRedirects,
    accept_invalid_certs: settings.acceptInvalidCerts,
  };
}

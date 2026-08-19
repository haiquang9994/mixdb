import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { RestResponse, WireRequest } from "./types";

/**
 * The only file in this module that talks to the native side.
 *
 * Both commands reject with an `AppError` — `{ code, params }` — which callers put through
 * `errorMessage(t, e)` rather than rendering. One code is not an error at all: `error.restCancelled`
 * is what a cancelled send comes back as, and the status bar says "Cancelled" instead of a banner.
 */

/** The code a cancelled send rejects with. Named here so no caller has to spell it. */
export const CANCELLED = "error.restCancelled";

/** Sends the request and waits for all of it. A `500` resolves — only a failure to get any
 *  response at all rejects. */
export function restSend(req: WireRequest): Promise<RestResponse> {
  return invoke<RestResponse>("rest_send", { req });
}

/** Cuts a send short by the `request_id` it was given. Never rejects for a send already finished. */
export function restCancel(requestId: string): Promise<void> {
  return invoke("rest_cancel", { requestId });
}

/** The response body as bytes. Everything downstream — decoding to text, sniffing the type,
 *  the hex dump — works from these rather than from the base64. */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The file picker, for a multipart part and for a binary body. Null when the dialog was dismissed,
 *  which every caller reads as "keep whatever the row already had". */
export async function pickFile(): Promise<string | null> {
  const path = await open({ multiple: false, directory: false });
  return typeof path === "string" ? path : null;
}

/**
 * The OS credential store, where a variable marked secret keeps its value.
 *
 * `secrets.rs` is shared and takes any string as an id, so this module writes its entries under
 * `rest-env:<envId>` and nothing new was needed on the Rust side. Saving an empty map deletes the
 * entry rather than storing `{}` — an environment with nothing to hide leaves nothing behind.
 */
export function envSecretsSave(id: string, secrets: Record<string, string>): Promise<void> {
  return invoke("secrets_save", { id, secrets });
}

/** What is stored for an environment, or nothing when it has never had a secret in it. */
export function envSecretsLoad(id: string): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("secrets_load", { id });
}

/** Forgets an environment's secrets, for when the environment itself goes. */
export function envSecretsDelete(id: string): Promise<void> {
  return invoke("secrets_delete", { id });
}

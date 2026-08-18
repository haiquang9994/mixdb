//! What crosses the boundary for a REST request. Mirrored by hand in
//! `src/modules/rest/types.ts` — nothing checks that the two agree.

use serde::{Deserialize, Serialize};

/// A request with every decision already made: the URL is final, the headers are final, the body
/// is already encoded. Rust chooses nothing here.
#[derive(Debug, Deserialize)]
pub struct WireRequest {
    /// What `rest_cancel` names. Minted per send, not per request.
    pub request_id: String,
    pub method: String,
    pub url: String,
    /// A list, not a map: a header may legitimately appear twice.
    pub headers: Vec<(String, String)>,
    pub body: WireBody,
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub accept_invalid_certs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WireBody {
    None,
    /// Raw and form-urlencoded alike: the frontend encoded it and declared its type.
    Text { text: String },
    /// A file streamed from disk.
    File { path: String },
    /// The one body Rust assembles, because the boundary and the file streaming are reqwest's.
    Multipart { parts: Vec<WirePart> },
}

#[derive(Debug, Deserialize)]
pub struct WirePart {
    pub name: String,
    /// The field's text, for a plain part.
    pub value: Option<String>,
    /// A file to send instead.
    pub path: Option<String>,
}

/// One response, whole. A `500` is a successful send and comes back through here like any other.
#[derive(Debug, Serialize)]
pub struct RestResponse {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub headers: Vec<(String, String)>,
    /// Base64 even for text: a response may be an image, a PDF or a gzip, and nothing here can
    /// assume UTF-8. The 33% the encoding adds is the price of not guessing.
    pub body_base64: String,
    /// The real length, including anything cut for being over the cap.
    pub body_size: u64,
    pub truncated: bool,
    /// Where the request ended up, which is how the frontend knows it was redirected.
    pub final_url: String,
    pub total_ms: u64,
    /// Time to the last header, i.e. when the response began rather than when it finished.
    pub ttfb_ms: u64,
}

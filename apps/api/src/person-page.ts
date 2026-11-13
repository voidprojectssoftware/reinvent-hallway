// /@handle is a web app page, but the static assets layer will not serve it:
// it re-encodes each path segment with encodeURIComponent and redirects when
// the result differs, so /@jane answers 307 to /%40jane and every share link
// would change in the address bar. So the Worker takes /@* first
// (wrangler.jsonc run_worker_first) and answers with the web app's
// index.html itself, under the URL as typed.
//
// ADR 0005 has the Worker render this path anyway, for the link preview tags
// LinkedIn reads; that work adds them to this response.

/** The part of the ASSETS binding this needs. */
export interface Assets {
  fetch(input: string): Promise<Response>;
}

export function isPersonPage(url: URL): boolean {
  return url.pathname.startsWith("/@");
}

/** The web app's shell, which routes /@handle in the browser. */
export function personPage(url: URL, assets: Assets): Promise<Response> {
  return assets.fetch(new URL("/", url).href);
}

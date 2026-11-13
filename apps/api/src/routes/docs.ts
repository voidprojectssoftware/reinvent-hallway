// GET /api/docs: the API reference, a Scalar viewer over /api/openapi.json
// (ADR 0017). A page, not an API resource, so it is not in the OpenAPI
// document itself.
//
// Scalar's standalone bundle comes from jsDelivr at a pinned version with a
// Subresource Integrity hash, so a changed file on the CDN is refused by the
// browser rather than run. To move to another version: change the version,
// fetch the file and put its sha384 here
// (`curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`).
//
// The sidebar lists each operation by its route (`GET /api/auth/options`), not
// its summary sentence, which still shows on the operation itself (#79).
import type { ApiApp } from "../app.ts";

export const scalarVersion = "1.76.2";
const scalarUrl = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${scalarVersion}/dist/browser/standalone.js`;
const scalarIntegrity = "sha384-mCh2A/B6vkfhiHyzwBZm7lbFmEK5fE/96Kbtk+RH1zei1P/XEt0I2MCiG6WfZdor";

export const apiDocsPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hallway API</title>
</head>
<body>
<div id="app"></div>
<script src="${scalarUrl}" integrity="${scalarIntegrity}" crossorigin="anonymous"></script>
<script>Scalar.createApiReference("#app", { url: "/api/openapi.json", operationTitleSource: "path" });</script>
</body>
</html>
`;

export function registerDocsRoutes<B extends object>(app: ApiApp<B>) {
  app.get("/api/docs", (c) => c.html(apiDocsPage));
}

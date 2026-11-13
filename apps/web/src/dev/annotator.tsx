// The owner's annotation toolbar (#105, ADR 0028). He clicks an element on
// the running app and writes a note; the note goes to this checkout's note
// server, and an agent reads it with `npm run notes -- pending` or the
// agentation MCP tools.
//
// `main.tsx` imports this file only when the build was made with
// VITE_NOTES=1, which `npm run dev` and Aspire's `web` resource set and
// `npm run build` never does (the web app is always a production build here,
// ADR 0010, so `import.meta.env.DEV` cannot tell them apart). Without the
// flag the import is dead code and the bundle carries none of this.
//
// The host is the one the page was reached by, so the owner's LAN address
// and localhost both work with the same line. The port is the checkout's note
// channel, put into the build as VITE_NOTE_PORT by whoever started its server.
//
// A browser driven by automation (`navigator.webdriver`) gets no toolbar
// unless the URL carries `?annotate`, so an agent's screenshots of a running
// app are of the app.
import { Agentation } from "agentation";
import { createRoot } from "react-dom/client";

const port = Number(import.meta.env.VITE_NOTE_PORT);
const automated = navigator.webdriver && !new URLSearchParams(window.location.search).has("annotate");

if (Number.isInteger(port) && port > 0 && !automated) {
  const endpoint = `http://${window.location.hostname}:${port}`;
  const host = document.createElement("div");
  host.id = "agentation-root";
  document.body.appendChild(host);
  createRoot(host).render(
    <Agentation
      endpoint={endpoint}
      onSessionCreated={(sessionId) => {
        // The session id is what an agent needs to read one page's notes.
        console.info(`[agentation] session ${sessionId} at ${endpoint}`);
      }}
    />,
  );
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "./routes.tsx";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";

// The owner's annotation toolbar (#105, ADR 0028), only in a build made with
// VITE_NOTES=1 (`npm run dev`, Aspire). Elsewhere the condition is a constant
// false, so the import and its chunk are left out of the bundle.
if (import.meta.env.VITE_NOTES === "1") void import("./dev/annotator.tsx");

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root.");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

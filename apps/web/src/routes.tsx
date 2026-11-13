// Every path the web app answers, and the screen each one shows. The Worker
// serves index.html for any path that is not a file and not its own (/api,
// /mcp, /cal: apps/api/wrangler.jsonc), so each of these survives a reload.
import { createBrowserRouter, useRouteError } from "react-router";
import { ApiFailure } from "./api/client.ts";
import { ConnectAgent } from "./screens/ConnectAgent.tsx";
import { MyWeek, myWeekLoader } from "./screens/MyWeek.tsx";
import { Network } from "./screens/Network.tsx";
import { NotFound } from "./screens/NotFound.tsx";
import { Person } from "./screens/Person.tsx";
import { Session } from "./screens/Session.tsx";
import { Settings } from "./screens/Settings.tsx";
import { SignIn, signInLoader } from "./screens/SignIn.tsx";
import { AppLayout } from "./shell/AppLayout.tsx";
import { Empty } from "./shell/Empty.tsx";
import { Screen } from "./shell/Screen.tsx";

export const router = createBrowserRouter([
  { path: "/sign-in", element: <SignIn />, loader: signInLoader, HydrateFallback: Loading },
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <MyWeek />, loader: myWeekLoader, HydrateFallback: Loading, errorElement: <LoadFailed /> },
      { path: "/network", element: <Network /> },
      { path: "/connect", element: <ConnectAgent /> },
      { path: "/settings", element: <Settings /> },
      { path: "/sessions/:sessionId", element: <Session /> },
      // /@handle. Static paths above win over this one; Person shows
      // NotFound for a segment without the @.
      { path: "/:segment", element: <Person /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

// The first paint while a loader runs: nothing, rather than a spinner that
// would flash for the few milliseconds a local API takes.
function Loading() {
  return null;
}

function LoadFailed() {
  const error = useRouteError();
  const message = error instanceof ApiFailure ? error.message : "Something went wrong loading this screen.";
  return (
    <Screen title="Hallway">
      <Empty icon="week" title="Could not load this screen">
        {message}
      </Empty>
    </Screen>
  );
}

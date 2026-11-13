// Every path the web app answers, and the screen each one shows. The Worker
// serves index.html for any path that is not a file and not its own (/api,
// /mcp, /cal: apps/api/wrangler.jsonc), so each of these survives a reload.
//
// A screen that is only mine sends a signed-out visitor to /sign-in from its
// loader (requireSignIn); a /@handle and a session are open to anyone.
import { createBrowserRouter, useRouteError } from "react-router";
import { ApiFailure } from "./api/client.ts";
import { ConnectAgent, connectAgentLoader } from "./screens/ConnectAgent.tsx";
import { MyWeek, myWeekLoader } from "./screens/MyWeek.tsx";
import { Network, networkLoader } from "./screens/Network.tsx";
import { NotFound } from "./screens/NotFound.tsx";
import { Person, personLoader } from "./screens/Person.tsx";
import { Profile, profileLoader } from "./screens/Profile.tsx";
import { Session, sessionLoader } from "./screens/Session.tsx";
import { Settings, settingsLoader } from "./screens/Settings.tsx";
import { SignIn, signInLoader } from "./screens/SignIn.tsx";
import { APP_ROUTE_ID, AppLayout, appLoader } from "./shell/AppLayout.tsx";
import { Empty } from "./shell/Empty.tsx";
import { Screen } from "./shell/Screen.tsx";

export const router = createBrowserRouter([
  { path: "/sign-in", element: <SignIn />, loader: signInLoader, HydrateFallback: Loading },
  {
    id: APP_ROUTE_ID,
    element: <AppLayout />,
    loader: appLoader,
    HydrateFallback: Loading,
    errorElement: <LoadFailed />,
    children: [
      {
        // Pathless, so a screen that fails to load fails inside the frame
        // and keeps the tab bar.
        errorElement: <LoadFailed />,
        children: [
          { path: "/", element: <MyWeek />, loader: myWeekLoader },
          { path: "/network", element: <Network />, loader: networkLoader },
          { path: "/connect", element: <ConnectAgent />, loader: connectAgentLoader },
          { path: "/settings", element: <Settings />, loader: settingsLoader },
          { path: "/settings/profile", element: <Profile />, loader: profileLoader },
          { path: "/sessions/:sessionId", element: <Session />, loader: sessionLoader },
          // /@handle. Static paths above win over this one; Person shows
          // NotFound for a segment without the @.
          { path: "/:segment", element: <Person />, loader: personLoader },
          { path: "*", element: <NotFound /> },
        ],
      },
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
  const message =
    error instanceof ApiFailure
      ? error.kind === "unreachable"
        ? "Hallway could not be reached. Check your connection and reload."
        : error.message
      : "Something went wrong loading this screen.";
  return (
    <Screen title="Hallway">
      <Empty icon="week" title="Could not load this screen">
        {message}
      </Empty>
    </Screen>
  );
}

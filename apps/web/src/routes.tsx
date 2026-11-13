// Every path the web app answers, and the screen each one shows. The Worker
// serves index.html for any path that is not a file and not its own (/api,
// /mcp, /cal: apps/api/wrangler.jsonc), so each of these survives a reload.
//
// A screen that is only mine sends a signed-out visitor to /sign-in from its
// loader (requireSignIn); a /@handle and a session are open to anyone.
import { createBrowserRouter, Link, useLocation, useRevalidator, useRouteError } from "react-router";
import { Compose, composeLoader } from "./screens/Compose.tsx";
import { ConnectAgent, connectAgentLoader } from "./screens/ConnectAgent.tsx";
import { MyWeek, myWeekLoader } from "./screens/MyWeek.tsx";
import { Network, networkLoader } from "./screens/Network.tsx";
import { NotFound } from "./screens/NotFound.tsx";
import { Person, personLoader } from "./screens/Person.tsx";
import { Profile, profileLoader } from "./screens/Profile.tsx";
import { Session, sessionLoader } from "./screens/Session.tsx";
import { Sessions, sessionsLoader } from "./screens/Sessions.tsx";
import { Settings, settingsLoader } from "./screens/Settings.tsx";
import { SignIn, signInLoader } from "./screens/SignIn.tsx";
import { APP_ROUTE_ID, AppLayout, appLoader } from "./shell/AppLayout.tsx";
import { Empty } from "./shell/Empty.tsx";
import { useLogged } from "./shell/Foot.tsx";
import { describeProblem } from "./shell/problem.ts";
import { Screen } from "./shell/Screen.tsx";
import { signInPath } from "./shell/signed-in.ts";

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
          { path: "/share/post", element: <Compose />, loader: composeLoader },
          { path: "/sessions", element: <Sessions />, loader: sessionsLoader },
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

/** The large title of each screen whose title does not depend on what loads. */
const titles: Record<string, string> = {
  "/": "My week",
  "/sessions": "Find a session",
  "/network": "Network",
  "/connect": "Connect your agent",
  "/settings": "Settings",
  "/settings/profile": "Profile",
  "/share/post": "Tell people you're going",
  "/sign-in": "Hallway",
};

const titleOf = (pathname: string): string | undefined => titles[pathname.replace(/(.)\/$/, "$1")];

// The first paint while the first loaders run: the frame and the screen's
// title at once, so a slow network shows where the tap went rather than a
// blank page. "Loading" appears only after a moment (app.css), so a fast
// answer does not flash it.
function Loading() {
  const title = titleOf(window.location.pathname);
  return (
    <>
      <header className="nav">
        <div className="col gutter nav-row" />
      </header>
      <main className="col gutter" aria-busy="true">
        {title && (
          <div className="large">
            <h1>{title}</h1>
          </div>
        )}
        <p className="loading-note" role="status">
          Loading…
        </p>
      </main>
    </>
  );
}

// A screen whose loader failed: what happened in plain words and the next
// step (problem.ts), with Try again re-running the loaders in place.
function LoadFailed() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const here = useLocation();
  useLogged(error);
  const problem = describeProblem(error);
  return (
    <Screen title={titleOf(here.pathname) ?? "Hallway"}>
      <Empty
        icon="week"
        title="This screen did not load"
        action={
          problem.next === "sign-in" ? (
            <Link className="btn" to={signInPath(here.pathname + here.search)}>
              Sign in
            </Link>
          ) : (
            <button className="btn" type="button" disabled={revalidator.state === "loading"} onClick={() => void revalidator.revalidate()}>
              Try again
            </button>
          )
        }
      >
        {problem.text}
      </Empty>
    </Screen>
  );
}

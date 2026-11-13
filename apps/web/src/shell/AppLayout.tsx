// The frame every screen but sign-in sits in: the screen, and the tab bar
// that becomes a sidebar from 1000 px (components.css, `body.app`).
//
// The tab bar is for someone signed in. A signed-out visitor reaches only a
// public /@handle (every other screen sends them to sign in), and sees it
// without tabs that would each send them to sign in (docs/design/README.md,
// open points). So the layout asks GET /api/me once, and the screens read the
// answer with useMe(). It also counts the requests waiting for me, for the
// red badge on the Network tab (network.html); revalidating after an accept
// or decline updates it. Someone whose handle is still a placeholder is
// asked to choose one (HandlePrompt).
import type { Me } from "@hallway/contracts";
import { useEffect } from "react";
import { NavLink, Outlet, useRouteLoaderData } from "react-router";
import { api } from "../api/client.ts";
import { HandlePrompt } from "../profile/HandlePrompt.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { ifSignedIn } from "./signed-in.ts";

const tabs: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "My week", icon: "week" },
  { to: "/network", label: "Network", icon: "people" },
  { to: "/connect", label: "Agent", icon: "agent" },
  { to: "/settings", label: "Settings", icon: "gear" },
];

export const APP_ROUTE_ID = "app";

export async function appLoader(): Promise<{ me: Me | null; waiting: number }> {
  const me = await ifSignedIn(api.me());
  if (!me) return { me, waiting: 0 };
  // The badge is a nicety: a failed count must not take the whole frame down.
  const waiting = await api.requests().then(
    (requests) => requests.incoming.length,
    () => 0,
  );
  return { me, waiting };
}

/** The signed-in attendee, or null for a signed-out visitor. */
export function useMe(): Me | null {
  return useRouteLoaderData<typeof appLoader>(APP_ROUTE_ID)?.me ?? null;
}

export function AppLayout() {
  const me = useMe();
  const waiting = useRouteLoaderData<typeof appLoader>(APP_ROUTE_ID)?.waiting ?? 0;
  useEffect(() => {
    if (!me) return;
    document.body.classList.add("app");
    return () => document.body.classList.remove("app");
  }, [me]);

  return (
    <>
      <Outlet />
      {me && <HandlePrompt me={me} />}
      {me && (
        <nav className="tabbar" aria-label="Hallway">
          <span className="brand">Hallway</span>
          {tabs.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.to === "/"}>
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
              {tab.to === "/network" && waiting > 0 && (
                <span className="badge-n" aria-label={waiting === 1 ? "1 request" : `${waiting} requests`}>
                  {waiting}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}

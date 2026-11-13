// The frame every screen but sign-in sits in: the screen, and the tab bar
// that becomes a sidebar from 1000 px (components.css, `body.app`).
//
// The tab bar is for someone signed in. A signed-out visitor reaches only a
// public /@handle (every other screen sends them to sign in), and sees it
// without tabs that would each send them to sign in (docs/design/README.md,
// open points). So the layout asks GET /api/me once, and the screens read the
// answer with useMe().
import type { Me } from "@hallway/contracts";
import { useEffect } from "react";
import { NavLink, Outlet, useRouteLoaderData } from "react-router";
import { api } from "../api/client.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { ifSignedIn } from "./signed-in.ts";

const tabs: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "My week", icon: "week" },
  { to: "/network", label: "Network", icon: "people" },
  { to: "/connect", label: "Agent", icon: "agent" },
  { to: "/settings", label: "Settings", icon: "gear" },
];

export const APP_ROUTE_ID = "app";

export function appLoader(): Promise<Me | null> {
  return ifSignedIn(api.me());
}

/** The signed-in attendee, or null for a signed-out visitor. */
export function useMe(): Me | null {
  return useRouteLoaderData<typeof appLoader>(APP_ROUTE_ID) ?? null;
}

export function AppLayout() {
  const me = useMe();
  useEffect(() => {
    if (!me) return;
    document.body.classList.add("app");
    return () => document.body.classList.remove("app");
  }, [me]);

  return (
    <>
      <Outlet />
      {me && (
        <nav className="tabbar" aria-label="Hallway">
          <span className="brand">Hallway</span>
          {tabs.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.to === "/"}>
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}

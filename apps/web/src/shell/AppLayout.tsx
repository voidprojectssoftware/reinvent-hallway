// The signed-in frame: the screen, and the tab bar that becomes a sidebar
// from 1000 px (components.css, `body.app`). The sign-in screen sits outside
// it, so it gets neither the bar nor the sidebar's left padding.
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router";
import { Icon, type IconName } from "./Icon.tsx";

const tabs: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "My week", icon: "week" },
  { to: "/network", label: "Network", icon: "people" },
  { to: "/connect", label: "Agent", icon: "agent" },
  { to: "/settings", label: "Settings", icon: "gear" },
];

export function AppLayout() {
  useEffect(() => {
    document.body.classList.add("app");
    return () => document.body.classList.remove("app");
  }, []);

  return (
    <>
      <Outlet />
      <nav className="tabbar" aria-label="Hallway">
        <span className="brand">Hallway</span>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === "/"}>
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

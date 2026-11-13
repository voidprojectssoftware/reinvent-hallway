// The design's empty state: one centered cell, a tinted glyph, a line in bold,
// a line of text and, when there is something to do, one button.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

interface EmptyProps {
  icon: IconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function Empty({ icon, title, children, action }: EmptyProps) {
  return (
    <section className="section">
      <div className="group">
        <div className="empty">
          <Icon name={icon} />
          <b>{title}</b>
          <p>{children}</p>
          {action}
        </div>
      </div>
    </section>
  );
}

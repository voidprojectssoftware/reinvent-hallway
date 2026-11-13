// What makes an action sheet modal for the keyboard and for screen readers,
// not only for the eye: while it is open the page under it is inert (no
// focus, no clicks, out of the accessibility tree), Tab and Shift+Tab go
// round the sheet's own controls, Escape closes it, and closing it puts focus
// back on whatever opened it (the Share button), as WAI-ARIA's dialog pattern
// asks. The sheets are portalled into body, beside #root, so inerting #root
// leaves the sheet alone.
import { useEffect, useRef, type RefObject } from "react";

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModal(sheet: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    // The dialog itself (tabIndex -1), so a screen reader starts at its
    // title and the first Tab reaches its first control, whatever has loaded.
    sheet.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !sheet.current) return;
      const controls = [...sheet.current.querySelectorAll<HTMLElement>(focusable)];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      const inside = sheet.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root?.removeAttribute("inert");
      if (opener?.isConnected) opener.focus();
    };
  }, [sheet]);
}

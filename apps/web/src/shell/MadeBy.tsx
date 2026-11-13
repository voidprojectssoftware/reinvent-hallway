// "Made by Void Projects": the credit every Void-built site carries, linking
// to voidprojects.ai/websites (issue #106, ADR 0027). It sits in one place
// per screen size: the foot of the sidebar on a wide screen, the end of
// Settings on a phone, and under the buttons on the sign-in screen. The mark
// is the vendored file (brand/void-mark.svg), never voidprojects.ai's own
// /api/mark.svg, so Hallway draws it with that site down.
import mark from "../brand/void-mark.svg";

export function MadeBy({ className }: { className?: string }) {
  return (
    <a
      className={className ? `madeby ${className}` : "madeby"}
      href="https://voidprojects.ai/websites"
      target="_blank"
      rel="noopener"
    >
      <img src={mark} width={20} height={20} alt="" />
      <span>
        Made by <strong>Void Projects</strong>
      </span>
      <span className="vh">(opens in a new tab)</span>
    </a>
  );
}

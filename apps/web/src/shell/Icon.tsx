// The design's line glyphs (docs/design/icons.svg), served from public/ as a
// sprite. The href is absolute because the app's paths are nested
// (/sessions/:id) and a relative one would resolve under them.
export type IconName =
  | "back" | "chev" | "week" | "people" | "agent" | "gear" | "share" | "out" | "lock" | "check"
  | "clock" | "pin" | "mic" | "tag" | "copy" | "plus" | "search" | "link" | "cal" | "photo"
  | "eye-off" | "doc" | "key" | "sun" | "list" | "map";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/icons.svg#i-${name}`} />
    </svg>
  );
}

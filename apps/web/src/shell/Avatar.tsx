// A person's face: their picture when they have one, else their initials on
// one of the design's eight hues, picked from their id so a person keeps the
// same color on every screen.
interface AvatarProps {
  person: { id: string; displayName: string; avatarUrl?: string | undefined };
  size?: "sm" | "lg";
}

export function Avatar({ person, size }: AvatarProps) {
  return (
    <span className={size ? `av ${size}` : "av"} data-c={hue(person.id)} aria-hidden="true">
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person.displayName)}
    </span>
  );
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function hue(id: string): number {
  let sum = 0;
  for (const char of id) sum = (sum * 31 + char.charCodeAt(0)) >>> 0;
  return (sum % 8) + 1;
}

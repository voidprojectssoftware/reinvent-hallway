// Where to send a browser after signing in (`returnTo`). It ends up in a
// Location header, so anything but a path on this origin is an open redirect:
// `//evil.example` and `/\evil.example` are other hosts to a browser, a tab
// or newline inside one is dropped by the URL parser and leaves `//`, and a
// percent-encoded `%2F` can turn into one in whatever decodes it next. The
// web app and the API check with this one function.
import { z } from "zod";

const maxLength = 2048;
// Control characters (C0 and DEL), which URL parsers strip, and the backslash,
// which browsers read as a slash.
const unsafe = /[\u0000-\u001f\u007f\\]/;
const probe = "https://return-path.invalid";

/** Same-origin-shaped: one leading slash, then nothing a parser could turn into another host. */
function pathShaped(text: string): boolean {
  return text.startsWith("/") && !text.startsWith("//") && !unsafe.test(text);
}

/**
 * True only for a relative path on this origin: it starts with a single `/`,
 * holds no backslash or control character, stays that way however many times
 * it is percent-decoded, and resolves to this origin. Anything else (another
 * scheme, `//host`, `/\host`, `/%2F%2Fhost`, malformed escapes) is false.
 */
export function isReturnPath(path: string): boolean {
  if (path.length === 0 || path.length > maxLength) return false;
  let text = path;
  // Decode until it stops changing: a double-encoded `%252F` is a slash two decodes on.
  for (let round = 0; round < 4; round++) {
    if (!pathShaped(text)) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      return false;
    }
    if (decoded === text) break;
    if (round === 3) return false;
    text = decoded;
  }
  try {
    return new URL(path, probe).origin === probe;
  } catch {
    return false;
  }
}

export const ReturnPath = z
  .string()
  .max(maxLength)
  .refine(isReturnPath, { message: "returnTo must be a path on this site, starting with a single /." })
  .meta({ description: "A path on this site to come back to after signing in, such as `/@jane-doe`.", example: "/@jane-doe" });

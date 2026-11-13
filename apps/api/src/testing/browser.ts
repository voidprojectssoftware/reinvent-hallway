// A browser's cookie jar, reduced to what Hallway's routes set: name, value
// and path. A cookie goes only to paths under its own, as a browser sends it,
// so a test notices when the OAuth state cookie would reach the wrong callback.
export const origin = "http://127.0.0.1:8787";

export class Browser {
  private jar = new Map<string, { value: string; path: string }>();
  constructor(private readonly call: (input: string, init?: RequestInit) => Promise<Response>) {}

  async fetch(path: string, init: RequestInit = {}) {
    const url = new URL(path, origin);
    const headers = new Headers(init.headers);
    const sent = [...this.jar].filter(([, cookie]) => url.pathname.startsWith(cookie.path));
    if (sent.length) headers.set("cookie", sent.map(([name, cookie]) => `${name}=${cookie.value}`).join("; "));
    const response = await this.call(url.toString(), { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";").map((part) => part.trim());
      const [name = "", value = ""] = pair.split("=");
      const path = attributes.find((attribute) => /^path=/i.test(attribute))?.slice(5) ?? "/";
      if (value === "" || /max-age=0/i.test(cookie)) this.jar.delete(name);
      else this.jar.set(name, { value, path });
    }
    return response;
  }

  cookie(name: string) {
    return this.jar.get(name)?.value;
  }
}

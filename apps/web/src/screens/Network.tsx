// Network, as a placeholder until #33 builds it over #15's endpoints. It is
// only mine, so a signed-out visitor is sent to sign in like the other tabs.
import type { Me } from "@hallway/contracts";
import { api } from "../api/client.ts";
import { Empty } from "../shell/Empty.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";

export function networkLoader(): Promise<Me> {
  return requireSignIn(api.me());
}

export function Network() {
  return (
    <Screen title="Network">
      <Empty icon="people" title="No connections yet">
        Requests, people from your LinkedIn connections and your connections will be listed here.
      </Empty>
    </Screen>
  );
}

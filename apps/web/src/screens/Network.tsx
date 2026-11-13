// Network, as a placeholder until the network screen issue.
import { Empty } from "../shell/Empty.tsx";
import { Screen } from "../shell/Screen.tsx";

export function Network() {
  return (
    <Screen title="Network">
      <Empty icon="people" title="No connections yet">
        Requests, people from your LinkedIn connections and your connections will be listed here.
      </Empty>
    </Screen>
  );
}

// Settings, as a placeholder until its screen issue.
import { Empty } from "../shell/Empty.tsx";
import { Screen } from "../shell/Screen.tsx";

export function Settings() {
  return (
    <Screen title="Settings">
      <Empty icon="gear" title="Nothing to set yet">
        Who sees your week, your calendar feed, agent tokens and your LinkedIn import will be here.
      </Empty>
    </Screen>
  );
}

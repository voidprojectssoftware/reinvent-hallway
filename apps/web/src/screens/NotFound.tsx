// A path the app has no screen for. The Worker served index.html for it
// (SPA fallback), so saying so is the app's job.
import { Link } from "react-router";
import { Empty } from "../shell/Empty.tsx";
import { Screen } from "../shell/Screen.tsx";

export function NotFound() {
  return (
    <Screen title="Not found">
      <Empty
        icon="search"
        title="Nothing at this address"
        action={
          <Link className="btn" to="/">
            My week
          </Link>
        }
      >
        The link may be mistyped, or the page may have moved.
      </Empty>
    </Screen>
  );
}

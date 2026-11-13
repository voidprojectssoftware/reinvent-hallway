// When to ask someone with a placeholder handle (`attendee-` and four random
// characters, made because their name had no Latin letter) to choose one
// (issue #48). Asked once per visit: "Not now" holds for this tab, and the
// next visit asks again, until they choose. Never over a person's page,
// which may be an invite being accepted, nor over the form that answers it.

const dismissedKey = "hallway.handle-prompt-dismissed";

export function shouldAskForHandle(handlePlaceholder: boolean, pathname: string, dismissed: boolean): boolean {
  if (!handlePlaceholder || dismissed) return false;
  return pathname !== "/settings/profile" && !pathname.startsWith("/@");
}

/** Whether "Not now" was said in this tab. Storage that refuses counts as not said: asking again is harmless. */
export function handlePromptDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(dismissedKey) !== null;
  } catch {
    return false;
  }
}

export function dismissHandlePrompt(): void {
  try {
    window.sessionStorage.setItem(dismissedKey, "1");
  } catch {
    // Not remembered: the prompt comes back on the next screen, which is the safe side.
  }
}

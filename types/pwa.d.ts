/**
 * BeforeInstallPromptEvent is fired when the browser is about to show the
 * "Add to Home Screen" prompt. It is not in the default TypeScript DOM lib.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}


// Owner: ux-curator
//
// First-launch flow: "permetti webcam" CTA, brief gesture cheatsheet, autopilot
// fallback when permission is denied. Renders into the #ui overlay.

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by ux-curator';

export class Onboarding {
  mount(_root: HTMLElement): void {
    throw new Error(NOT_IMPL);
  }
  unmount(): void {
    throw new Error(NOT_IMPL);
  }
  /** Resolves with true if the user clicks "permetti webcam" and approves. */
  awaitPermission(): Promise<boolean> {
    throw new Error(NOT_IMPL);
  }
}

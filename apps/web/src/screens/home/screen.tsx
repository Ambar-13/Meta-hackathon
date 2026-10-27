import type { ReactElement } from "react";
import { ScreenFrame } from "../../app-shell/index.js";

// The home screen, filled in by the design pass: your card, your meetings and pairs, and the next step.
export const HomeScreen = (): ReactElement => {
  return (
    <ScreenFrame title="Hello">
      <p>Your home.</p>
    </ScreenFrame>
  );
};

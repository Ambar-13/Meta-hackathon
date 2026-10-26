import type { ReactElement } from "react";
import { ScreenFrame } from "../../app-shell/screen-parts.js";

// Shows that this page is not built yet.
export const HelpScreen = (): ReactElement => {
  return (
    <ScreenFrame title="Find help">
      <p>This page is not built yet.</p>
    </ScreenFrame>
  );
};

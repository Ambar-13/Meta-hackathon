// The brief screen until the briefs builder replaces this folder in Wave 2 (seams S11).
import type { ReactElement } from "react";
import { ScreenFrame } from "../../app-shell/index.js";

// The brief page placeholder, which the briefs builder replaces in Wave 2.
export const BriefScreen = (): ReactElement => {
  return (
    <ScreenFrame title="Your brief">
      <p>This part arrives in the next build wave.</p>
    </ScreenFrame>
  );
};

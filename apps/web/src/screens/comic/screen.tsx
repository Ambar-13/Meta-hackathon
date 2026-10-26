// The comic screen until the comic builder replaces this folder in Wave 2 (seams S11).
import type { ReactElement } from "react";
import { ScreenFrame } from "../../app-shell/index.js";

// The comic page placeholder, which the comic builder replaces in Wave 2.
export const ComicScreen = (): ReactElement => {
  return (
    <ScreenFrame title="The comic">
      <p>This part arrives in the next build wave.</p>
    </ScreenFrame>
  );
};

// The public share page until the share-and-consent builder replaces this folder in Wave 2 (seams S11).
import type { ReactElement } from "react";
import { ScreenFrame } from "../../app-shell/index.js";

// The public share page placeholder, which the share-and-consent builder replaces in Wave 2.
export const PublicSharePage = (): ReactElement => {
  return (
    <ScreenFrame title="Shared meeting">
      <p>This part arrives in the next build wave.</p>
    </ScreenFrame>
  );
};

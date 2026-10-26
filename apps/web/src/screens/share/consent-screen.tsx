// The share-and-consent page until the share-and-consent builder replaces this folder in Wave 2 (seams S11).
import type { ReactElement } from "react";
import { ScreenFrame } from "../../app-shell/index.js";

// The share page placeholder, which the share-and-consent builder replaces in Wave 2.
export const ConsentScreen = (): ReactElement => {
  return (
    <ScreenFrame title="Share this meeting">
      <p>This part arrives in the next build wave.</p>
    </ScreenFrame>
  );
};

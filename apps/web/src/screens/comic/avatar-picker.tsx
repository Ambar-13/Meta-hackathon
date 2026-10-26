import type { ReactElement } from "react";
import { AVATARS, type Avatar } from "@meet-first/contracts";

// The props of the picker: the chosen avatar, whether a request is out, and what a pick or a draw does.
export type AvatarPickerProps = { selected: Avatar | null; isSending: boolean; onPick: (avatar: Avatar) => void; onDraw: () => void };

// The six avatars as radio cards in one fieldset, and the button that asks for the comic (R11.3).
export const AvatarPicker = (props: AvatarPickerProps): ReactElement => {
  const isDrawDisabled = props.selected === null || props.isSending;
  return (
    <>
      <fieldset className="avatar-picker">
        <legend>Pick your character</legend>
        {AVATARS.map((avatar) => (
          <label key={avatar} style={{ display: "block", padding: "8px 0" }}>
            <input type="radio" name="avatar" value={avatar} checked={props.selected === avatar} onChange={() => {
              props.onPick(avatar);
            }} /> {avatar}
          </label>
        ))}
      </fieldset>
      <button type="button" aria-disabled={isDrawDisabled} disabled={isDrawDisabled} onClick={props.onDraw}>
        Draw the comic
      </button>
    </>
  );
};

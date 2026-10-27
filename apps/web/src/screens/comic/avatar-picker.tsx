import type { ReactElement } from "react";
import { AVATARS, type Avatar } from "@meet-first/contracts";

// The props of the picker: the chosen avatar, whether a request is out, and what a pick or a draw does.
export type AvatarPickerProps = { selected: Avatar | null; isSending: boolean; onPick: (avatar: Avatar) => void; onDraw: () => void };

// The colour of each avatar card, in list order, cycling through the palette.
const CARD_COLOURS = ["c-coral", "c-blue", "c-green", "c-yellow", "c-lilac", "c-blue"] as const;

// The first word of an avatar, written large on its card: "fox" for "fox in a hoodie".
function animalOf(avatar: Avatar): string {
  return avatar.split(" ")[0] ?? avatar;
}

// The six avatars as radio cards in one fieldset, and the button that asks for the comic (R11.3).
export const AvatarPicker = (props: AvatarPickerProps): ReactElement => {
  const isDrawDisabled = props.selected === null || props.isSending;
  return (
    <>
      <fieldset className="avatar-picker">
        <legend>Pick your character</legend>
        <div className="avatar-grid">
          {AVATARS.map((avatar, index) => (
            <label key={avatar} className={`avatar-card ${CARD_COLOURS[index] ?? "c-blue"}`}>
              <input type="radio" name="avatar" value={avatar} checked={props.selected === avatar} onChange={() => {
                props.onPick(avatar);
              }} />
              <span className="avatar-art" aria-hidden="true">{animalOf(avatar)}</span>
              <span className="avatar-words">{avatar}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="actions">
        <button type="button" className="big" aria-disabled={isDrawDisabled} disabled={isDrawDisabled} onClick={props.onDraw}>
          Draw the comic
        </button>
      </div>
    </>
  );
};

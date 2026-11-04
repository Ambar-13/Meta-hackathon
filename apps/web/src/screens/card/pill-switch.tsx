import type { ReactElement } from "react";

// One on and off switch drawn as a pill, with its words as the label; the words are the consent, so they are shown in full.
// The native checkbox stays in the label, over the drawn pill, for screen readers, keyboards and the tests.
export const PillSwitch = (props: {
  label: string;
  isOn: boolean;
  isDisabled: boolean;
  onChange: (isOn: boolean) => void;
}): ReactElement => {
  return (
    <label className="switch-row">
      <input
        type="checkbox"
        role="switch"
        checked={props.isOn}
        disabled={props.isDisabled}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
      />
      <span className="pill-switch" aria-hidden="true" />
      <span className="switch-text">{props.label}</span>
    </label>
  );
};

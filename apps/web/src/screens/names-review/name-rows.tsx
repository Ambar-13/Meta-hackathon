import { type ReactElement } from "react";
import { NAMES_PAGE_SIZE, type NameRow } from "@meet-first/contracts";
import { initialOf } from "../../look/index.js";
import { OFFERED_OPT_INS, OPT_IN_LABELS, type SensitiveOptIn } from "./names-review-state.js";

// The one-tap choice: replace all names (preselected) or choose names to keep.
export const NamesModeChoice = (props: {
  mode: "replace_all" | "choose";
  onChange: (mode: "replace_all" | "choose") => void;
}): ReactElement => {
  return (
    <fieldset className="nr-mode">
      <legend>What should happen to these names?</legend>
      <label className="inline nr-option">
        <input
          type="radio"
          name="names-mode"
          value="replace_all"
          checked={props.mode === "replace_all"}
          onChange={() => {
            props.onChange("replace_all");
          }}
        />
        Replace all names with role labels
      </label>
      <label className="inline nr-option">
        <input
          type="radio"
          name="names-mode"
          value="choose"
          checked={props.mode === "choose"}
          onChange={() => {
            props.onChange("choose");
          }}
        />
        Choose names to keep
      </label>
    </fieldset>
  );
};

// The role groups of one page: the rows in first-seen role order.
function groupRows(rows: NameRow[]): Array<{ roleToken: string; rows: NameRow[] }> {
  const groups: Array<{ roleToken: string; rows: NameRow[] }> = [];
  for (const row of rows) {
    const group = groups.find((candidate) => candidate.roleToken === row.roleToken);
    if (group === undefined) groups.push({ roleToken: row.roleToken, rows: [row] });
    else group.rows.push(row);
  }
  return groups;
}

// The names of one page, grouped by role token, each with its context and, in choose mode, a keep
// box.
export const RoleGroups = (props: {
  rows: NameRow[];
  mode: "replace_all" | "choose";
  kept: ReadonlySet<string>;
  onToggle: (text: string) => void;
}): ReactElement => {
  return (
    <div className="nr-groups">
      {groupRows(props.rows).map((group) => (
        <section key={group.roleToken} className="nr-group">
          <h2>
            Replaced with <span className="nr-role">{group.roleToken}</span>
          </h2>
          <ul className="nr-list">
            {group.rows.map((row) => (
              <li
                key={row.text}
                className={
                  props.mode === "choose" && props.kept.has(row.text) ? "nr-row kept" : "nr-row"
                }
              >
                <span className="nr-initial" aria-hidden="true">
                  {initialOf(row.text)}
                </span>
                <span className="nr-words">
                  <strong>{row.text}</strong>{" "}
                  <span className="muted">{`Seen as: ${row.context}`}</span>
                </span>
                {props.mode === "choose" ? (
                  <label className="nr-keep">
                    <input
                      type="checkbox"
                      checked={props.kept.has(row.text)}
                      onChange={() => {
                        props.onToggle(row.text);
                      }}
                    />
                    {`Keep ${row.text}`}
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

// Previous and next page, 20 names per page.
export const NamesPager = (props: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}): ReactElement => {
  const pages = Math.max(1, Math.ceil(props.total / NAMES_PAGE_SIZE));
  return (
    <nav aria-label="Name pages" className="nr-pager">
      <button
        type="button"
        className="quiet"
        disabled={props.page <= 1}
        onClick={() => {
          props.onPage(props.page - 1);
        }}
      >
        Previous page
      </button>
      <span>{`Page ${String(props.page)} of ${String(pages)}`}</span>
      <button
        type="button"
        className="quiet"
        disabled={props.page >= pages}
        onClick={() => {
          props.onPage(props.page + 1);
        }}
      >
        Next page
      </button>
    </nav>
  );
};

// The three sensitive opt-ins, all off by default.
export const OptInChoices = (props: {
  optIns: ReadonlySet<SensitiveOptIn>;
  onToggle: (optIn: SensitiveOptIn) => void;
}): ReactElement => {
  return (
    <fieldset className="nr-optins">
      <legend>Keep these kinds of messages in your card and lookups</legend>
      <p className="muted">They stay out unless you tick them.</p>
      {OFFERED_OPT_INS.map((optIn) => (
        <label className="inline nr-option" key={optIn}>
          <input
            type="checkbox"
            checked={props.optIns.has(optIn)}
            onChange={() => {
              props.onToggle(optIn);
            }}
          />
          {OPT_IN_LABELS[optIn]}
        </label>
      ))}
    </fieldset>
  );
};

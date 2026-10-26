import { type ReactElement } from "react";
import { NAMES_PAGE_SIZE, type NameRow } from "@meet-first/contracts";
import { OFFERED_OPT_INS, OPT_IN_LABELS, type SensitiveOptIn } from "./names-review-state.js";

// The one-tap choice: replace all names (preselected) or choose names to keep (R2.4).
export const NamesModeChoice = (props: { mode: "replace_all" | "choose"; onChange: (mode: "replace_all" | "choose") => void }): ReactElement => {
  return (
    <fieldset>
      <legend>What should happen to these names?</legend>
      <label className="inline">
        <input type="radio" name="names-mode" value="replace_all" checked={props.mode === "replace_all"} onChange={() => { props.onChange("replace_all"); }} />
        Replace all names with role labels
      </label>
      <label className="inline">
        <input type="radio" name="names-mode" value="choose" checked={props.mode === "choose"} onChange={() => { props.onChange("choose"); }} />
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

// The names of one page, grouped by role token, each with its context and, in choose mode, a keep box (R2.4).
export const RoleGroups = (props: { rows: NameRow[]; mode: "replace_all" | "choose"; kept: ReadonlySet<string>; onToggle: (text: string) => void }): ReactElement => {
  return (
    <>
      {groupRows(props.rows).map((group) => (
        <section key={group.roleToken}>
          <h2>{`Replaced with ${group.roleToken}`}</h2>
          <ul>
            {group.rows.map((row) => (
              <li key={row.text}>
                <strong>{row.text}</strong> <span className="muted">{`Seen as: ${row.context}`}</span>
                {props.mode === "choose" ? (
                  <label className="inline">
                    <input type="checkbox" checked={props.kept.has(row.text)} onChange={() => { props.onToggle(row.text); }} />
                    {`Keep ${row.text}`}
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
};

// Previous and next page, 20 names per page (R2.4).
export const NamesPager = (props: { page: number; total: number; onPage: (page: number) => void }): ReactElement => {
  const pages = Math.max(1, Math.ceil(props.total / NAMES_PAGE_SIZE));
  return (
    <nav aria-label="Name pages">
      <button type="button" className="quiet" disabled={props.page <= 1} onClick={() => { props.onPage(props.page - 1); }}>
        Previous page
      </button>
      <span>{`Page ${String(props.page)} of ${String(pages)}`}</span>
      <button type="button" className="quiet" disabled={props.page >= pages} onClick={() => { props.onPage(props.page + 1); }}>
        Next page
      </button>
    </nav>
  );
};

// The three sensitive opt-ins, all off by default (D18).
export const OptInChoices = (props: { optIns: ReadonlySet<SensitiveOptIn>; onToggle: (optIn: SensitiveOptIn) => void }): ReactElement => {
  return (
    <fieldset>
      <legend>Keep these kinds of messages in your card and lookups</legend>
      <p className="muted">They stay out unless you tick them.</p>
      {OFFERED_OPT_INS.map((optIn) => (
        <label className="inline" key={optIn}>
          <input type="checkbox" checked={props.optIns.has(optIn)} onChange={() => { props.onToggle(optIn); }} />
          {OPT_IN_LABELS[optIn]}
        </label>
      ))}
    </fieldset>
  );
};

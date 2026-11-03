import "./lobby.css";
import type { ReactElement } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { MeetingView, PairView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, pairPathWithCard, readApprovedCard, readCardQuery, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, LoadingLine, NameTag } from "../../look/index.js";
import { MeetingList, QuestionPicker, StartPanel } from "./lobby-parts.js";
import { useLobby, type QuestionPick } from "./lobby-state.js";

// True when nobody accepted the invite and its 24 hours have passed, by the server's clock.
function isInviteExpired(pair: PairView): boolean {
  return pair.joiner === undefined && Date.parse(pair.serverNow) >= Date.parse(pair.expiresAt);
}

// The two names as tags: by meeting side when a meeting view gives sides (a coral, b blue), else the creator in coral and the joiner in blue.
function tagNames(pair: PairView, meeting: MeetingView | null): { a: string; b: string | null } {
  if (meeting !== null) {
    const sideA = meeting.members.find((member) => member.side === "a");
    const sideB = meeting.members.find((member) => member.side === "b");
    if (sideA !== undefined && sideB !== undefined) return { a: sideA.displayName, b: sideB.displayName };
  }
  return { a: pair.creator.displayName, b: pair.joiner?.displayName ?? null };
}

// The two name tags of the pair, with an empty dashed slot while the other person has not joined.
const PairTags = (props: { names: { a: string; b: string | null } }): ReactElement => {
  return (
    <div className="lobby-tags" aria-hidden="true">
      <NameTag name={props.names.a} colour="coral" className="lobby-tag-a" />
      <span className="lobby-and">&amp;</span>
      {props.names.b === null ? <span className="lobby-slot">?</span> : <NameTag name={props.names.b} colour="blue" className="lobby-tag-b" />}
    </div>
  );
};

// The line under the tags: paired, still waiting for the other person, or an invite that ran out.
const PairLine = (props: { pair: PairView; cardId: string | null }): ReactElement => {
  const { pair } = props;
  if (isInviteExpired(pair)) {
    const pairPath = props.cardId === null ? APP_PATHS.pair : pairPathWithCard(props.cardId);
    return (
      <EmptyState sticker="poof" title="This invite has expired" action={<Link className="btn" to={pairPath}>Make a new invite</Link>}>
        Nobody accepted it within 24 hours. Make a new one and send it again.
      </EmptyState>
    );
  }
  if (pair.joiner === undefined) return <LoadingLine text="Waiting for the other person to accept the invite." />;
  return <p className="lobby-line">{`${pair.creator.displayName} and ${pair.joiner.displayName} are paired.`}</p>;
};

// The part of the lobby below the pair line: the picker, the next meeting, or the note that a card is needed first.
const NextMeeting = (props: { current: boolean; hasCard: boolean; isBusy: boolean; createError: string | null; onCreate: (pick: QuestionPick) => void; meetingReady: ReactElement | null }): ReactElement => {
  if (props.current) return props.meetingReady ?? <LoadingLine text="Loading the meeting." />;
  if (!props.hasCard) {
    return (
      <EmptyState sticker="chat" title="No meeting yet">
        To create a meeting from this phone, open your card and tap Invite a friend.
      </EmptyState>
    );
  }
  return <QuestionPicker isSending={props.isBusy} error={props.createError} onCreate={props.onCreate} />;
};

// The /pairs/:pairId page: who is paired, the next meeting, and the question picker; it polls and never streams.
export const LobbyScreen = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const pairId = useParams()["pairId"] ?? "";
  const cardId = readCardQuery(location.search) ?? readApprovedCard();
  const lobby = useLobby(pairId, cardId, (path) => {
    navigate(path);
  });
  const pair = lobby.pair.value;
  if (pair === null) {
    return <ScreenFrame title="Set up the meeting">{lobby.pair.error === null ? <LoadingLine text="Loading the lobby." /> : <ErrorNotice error={lobby.pair.error} />}</ScreenFrame>;
  }
  const meetingView = lobby.meeting.value;
  const meetingReady = meetingView === null ? null : <StartPanel meeting={meetingView} isBusy={lobby.isBusy} error={lobby.actionError} onReady={() => void lobby.markReady()} />;
  return (
    <ScreenFrame title="Set up the meeting">
      <PairTags names={tagNames(pair, meetingView)} />
      <PairLine pair={pair} cardId={cardId} />
      {isInviteExpired(pair) ? null : <NextMeeting current={lobby.current !== null} hasCard={cardId !== null} isBusy={lobby.isBusy} createError={lobby.createError} onCreate={(pick) => void lobby.create(pick)} meetingReady={meetingReady} />}
      {pair.meetings.length > 0 ? <MeetingList meetings={pair.meetings} /> : null}
    </ScreenFrame>
  );
};

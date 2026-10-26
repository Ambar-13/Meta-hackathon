import type { ReactElement } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ErrorNotice, readApprovedCard, readCardQuery, ScreenFrame } from "../../app-shell/index.js";
import { MeetingList, QuestionPicker, StartPanel } from "./lobby-parts.js";
import { useLobby, type QuestionPick } from "./lobby-state.js";

// The part of the lobby below the pair line: the picker, the next meeting, or the note that a card is needed first.
const NextMeeting = (props: { current: boolean; hasCard: boolean; isBusy: boolean; createError: string | null; onCreate: (pick: QuestionPick) => void; meetingReady: ReactElement | null }): ReactElement => {
  if (props.current) return props.meetingReady ?? <p>Loading the meeting.</p>;
  if (!props.hasCard) return <p>To create a meeting from this phone, open your card and tap Pair with someone.</p>;
  return <QuestionPicker isSending={props.isBusy} error={props.createError} onCreate={props.onCreate} />;
};

// The /pairs/:pairId page: who is paired, the next meeting, and the question picker; it polls and never streams (D54, R8.6).
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
    return <ScreenFrame title="Lobby">{lobby.pair.error === null ? <p>Loading the lobby.</p> : <ErrorNotice error={lobby.pair.error} />}</ScreenFrame>;
  }
  const meetingView = lobby.meeting.value;
  const meetingReady = meetingView === null ? null : <StartPanel meeting={meetingView} isBusy={lobby.isBusy} error={lobby.actionError} onReady={() => void lobby.markReady()} />;
  return (
    <ScreenFrame title="Lobby">
      <p>{pair.joiner === undefined ? "Waiting for the other person to accept the invite." : `${pair.creator.displayName} and ${pair.joiner.displayName} are paired.`}</p>
      <NextMeeting current={lobby.current !== null} hasCard={cardId !== null} isBusy={lobby.isBusy} createError={lobby.createError} onCreate={(pick) => void lobby.create(pick)} meetingReady={meetingReady} />
      {pair.meetings.length > 0 ? <MeetingList meetings={pair.meetings} /> : null}
    </ScreenFrame>
  );
};

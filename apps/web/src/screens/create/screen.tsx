import "./create.css";
import type { FormEvent, ReactElement } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { POST_TEXT_MAX_CHARS, type PostKind } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, PROFILE_TAB_QUERY, readCreateKind, ScreenFrame } from "../../app-shell/index.js";
import { Icon, MeetyMark, StoryPicture } from "../../look/index.js";
import { canShare, useCreate, type CreateModel } from "./create-state.js";

// The words of Create.
const CREATE_COPY = {
  post: "New post",
  story: "New story",
  kindLabel: "What to share",
  kinds: { post: "Post", story: "Story" },
  choose: "Choose a photo",
  chooseLine: "Or share words alone.",
  change: "Change photo",
  remove: "Remove photo",
  drawing: "Getting your photo ready.",
  caption: { post: "Caption", story: "Words on your story" },
  placeholder: { post: "Write a caption", story: "Add words to your story" },
  storyLine: "Your story shows for 24 hours, then it is gone.",
  meety: "Your Meety reads what you share and the posts you like, to learn what you are into.",
  notListed: "Only you see your posts until you join Explore.",
  share: "Share",
  sharing: "Sharing",
  invite: "Invite a friend instead",
  preview: "Your photo",
} as const;
// From how many characters on the box shows how many are left.
const COUNT_FROM_CHARS = 500;

// Where Create goes once something is shared: a story to Home, where Your story leads the row; a post to Home, where the feed shows it,
// unless you are known not to be in Explore, when it goes to your own Posts tab, the one place it shows until you join.
function afterShare(kind: PostKind, listed: CreateModel["listed"]): string {
  if (kind === "post" && listed === "not-listed") return `${APP_PATHS.me}?${PROFILE_TAB_QUERY}=posts`;
  return APP_PATHS.home;
}

// The switch between a post and a story, as the two choices under Instagram's camera.
const KindSwitch = (props: { model: CreateModel }): ReactElement => {
  const { model } = props;
  return (
    <div className="create-kinds" role="group" aria-label={CREATE_COPY.kindLabel}>
      {(["post", "story"] as const).map((kind) => (
        <button key={kind} type="button" className="create-kind" aria-pressed={model.kind === kind} onClick={() => { model.setKind(kind); }}>
          {CREATE_COPY.kinds[kind]}
        </button>
      ))}
    </div>
  );
};

// A file picker that looks like the words it holds: the input fills the label, so a tap anywhere on it opens the photos or the camera.
const PhotoPicker = (props: { model: CreateModel; className: string; children: ReactElement | string }): ReactElement => {
  const isBusy = props.model.state.kind === "drawing" || props.model.state.kind === "sending";
  return (
    <label className={isBusy ? `${props.className} is-busy` : props.className}>
      {props.children}
      <input type="file" accept="image/*" className="create-file" disabled={isBusy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void props.model.pickPhoto(file);
        }} />
    </label>
  );
};

// The photo: before one is chosen, the large place to choose it, which also says words alone are fine; once chosen, the photo as it
// will show, square for a post and whole on its blurred copy for a story, with Change photo and Remove photo under it.
const PhotoPart = (props: { model: CreateModel }): ReactElement => {
  const { model } = props;
  if (model.photo === null) {
    return (
      <PhotoPicker model={model} className={`create-drop is-${model.kind}`}>
        <span className="create-drop-inner">
          <Icon name="photo" size={40} />
          <b>{model.state.kind === "drawing" ? CREATE_COPY.drawing : CREATE_COPY.choose}</b>
          <small>{CREATE_COPY.chooseLine}</small>
        </span>
      </PhotoPicker>
    );
  }
  return (
    <div className="create-photo">
      {model.kind === "story" ? (
        <StoryPicture src={model.photo.url} alt={CREATE_COPY.preview} text={model.text.trim()} className="create-preview" />
      ) : (
        <div className="post-photo is-square create-preview">
          <img src={model.photo.url} alt={CREATE_COPY.preview} />
        </div>
      )}
      <div className="create-photo-actions">
        <PhotoPicker model={model} className="btn quiet create-change">{CREATE_COPY.change}</PhotoPicker>
        <button type="button" className="text-button" onClick={model.removePhoto}>{CREATE_COPY.remove}</button>
      </div>
    </div>
  );
};

// The line under Share: a refusal before any request, or the api's error.
const ShareLine = (props: { model: CreateModel }): ReactElement | null => {
  const { state } = props.model;
  if (state.kind === "refused") return <p className="create-refusal" role="alert">{state.sentence}</p>;
  if (state.kind === "failed") return <ErrorNotice error={state.error} />;
  return null;
};

// Create, as Instagram's: Post or Story, the photo, the words, then Share, the page's one blue button. Above Share, a line says your
// Meety learns from what you share, and, while you are not in Explore, that only you see your posts. On a laptop the photo sits left of
// the words. Since the phone's + opens this page, Invite a friend is the last link.
export const CreateScreen = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const model = useCreate(readCreateKind(location.search));
  const isSending = model.state.kind === "sending";
  const isReady = canShare(model.text, model.photo) && model.state.kind !== "drawing" && !isSending;
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void model.share().then((created) => {
      if (created !== null) navigate(afterShare(created.kind, model.listed));
    });
  };
  const left = POST_TEXT_MAX_CHARS - model.text.length;
  return (
    <ScreenFrame title={model.kind === "post" ? CREATE_COPY.post : CREATE_COPY.story} isWide>
      <form className={`create is-${model.kind}`} onSubmit={onSubmit}>
        <KindSwitch model={model} />
        <div className="create-body">
          <PhotoPart model={model} />
          <div className="create-words">
            <label className="create-caption">
              {CREATE_COPY.caption[model.kind]}
              <textarea value={model.text} rows={4} maxLength={POST_TEXT_MAX_CHARS} placeholder={CREATE_COPY.placeholder[model.kind]}
                onChange={(event) => { model.setText(event.target.value); }} />
            </label>
            {model.text.length >= COUNT_FROM_CHARS ? <p className="create-count" aria-live="polite">{`${String(left)} characters left`}</p> : null}
            {model.kind === "story" ? <p className="create-note">{CREATE_COPY.storyLine}</p> : null}
            <p className="create-meety">
              <MeetyMark />
              {CREATE_COPY.meety}
            </p>
            {model.listed === "not-listed" && model.kind === "post" ? <p className="create-note">{CREATE_COPY.notListed}</p> : null}
            <ShareLine model={model} />
            <button type="submit" className="btn create-share" disabled={!isReady}>{isSending ? CREATE_COPY.sharing : CREATE_COPY.share}</button>
            <Link className="create-invite" to={APP_PATHS.pair}>{CREATE_COPY.invite}</Link>
          </div>
        </div>
      </form>
    </ScreenFrame>
  );
};

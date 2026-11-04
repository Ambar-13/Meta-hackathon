import type { ColumnType, Generated, JSONColumnType } from "kysely";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
// A timestamp the database fills in when a row is inserted. Kysely 0.27 would wrap a ColumnType inside Generated<>, so the alias spells out the same select, insert and update types.
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Bytes = ColumnType<Buffer, Buffer, Buffer>;

// One row of the people table, as migration 0001 defines it.
export interface PeopleTable {
  id: Generated<string>;
  display_name: string;
  affiliations: Generated<string[]>;
  state: Generated<"active" | "deleted">;
  recovery_code_hash: Bytes | null;
  recovery_code_used_at: NullableTimestamp;
  deleted_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
  is_sample: Generated<boolean>;
  summary_save_day: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  summary_saves_today: Generated<number>;
}
// One row of the sessions table, as migration 0001 defines it.
export interface SessionsTable {
  id: Generated<string>;
  person_id: string;
  token_hash: Bytes;
  expires_at: Timestamp;
  last_used_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}
// One row of the transfer_links table, as migration 0001 defines it.
export interface TransferLinksTable {
  id: Generated<string>;
  person_id: string;
  token_hash: Bytes;
  expires_at: Timestamp;
  used_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}
// One row of the sources table, as migration 0001 defines it.
export interface SourcesTable {
  id: Generated<string>;
  person_id: string;
  kind: "chatgpt" | "claude" | "notes" | "paste";
  content_hash: Bytes;
  turn_count: number;
  canonical_chars: number;
  persona_signal: ColumnType<string, number | string, number | string>;
  parser_version: string;
  scrub_version: string;
  chars_per_token: ColumnType<string | null, number | string | null, number | string | null>;
  attested_at: Timestamp;
  sensitive_opt_in: Generated<string[]>;
  names_reviewed_at: NullableTimestamp;
  frozen_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}
// One row of the turns table, as migration 0001 defines it.
export interface TurnsTable {
  id: Generated<string>;
  source_id: string;
  person_id: string;
  turn_index: number;
  role: "user";
  text: string;
  norm_text: string;
  lang: string | null;
  sensitive_categories: Generated<string[]>;
  created_at: GeneratedTimestamp;
}
// One row of the redactions table, as migration 0001 defines it.
export interface RedactionsTable {
  id: Generated<string>;
  source_id: string;
  turn_id: string;
  person_id: string;
  category: string;
  placeholder_id: string;
  created_at: GeneratedTimestamp;
}
// One row of the cards table, as migration 0001 defines it.
export interface CardsTable {
  id: Generated<string>;
  source_id: string;
  person_id: string;
  state: "building" | "ready" | "thin" | "failed" | "approved";
  model: string;
  prompt_version: string;
  items_total: number | null;
  items_verified: number | null;
  thin: Generated<boolean>;
  recall_allowed: Generated<boolean>;
  friends_can_ask: Generated<boolean>;
  built_at: NullableTimestamp;
  approved_at: NullableTimestamp;
  error: string | null;
  created_at: GeneratedTimestamp;
}
// One row of the card_items table, as migration 0001 defines it.
export interface CardItemsTable {
  id: Generated<string>;
  card_id: string;
  person_id: string;
  position: number;
  kind: "value" | "preference" | "habit" | "boundary" | "goal";
  claim: string;
  lang: string;
  gloss: string;
  turn_id: string;
  quote: string;
  norm_quote: string;
  verified: boolean;
  flagged: boolean;
  approved: Generated<boolean>;
  sensitive: Generated<boolean>;
  is_public: Generated<boolean>;
  created_at: GeneratedTimestamp;
}
// One row of the quiz_bank table, as migration 0001 defines it.
export interface QuizBankTable {
  bank_version: number;
  question_id: number;
  text: string;
}
// One row of the quizzes table, as migration 0001 defines it.
export interface QuizzesTable {
  id: Generated<string>;
  card_id: string;
  person_id: string;
  bank_version: number;
  seed: string;
  state: "answering" | "waiting_human" | "judging" | "judged" | "failed";
  matched: number | null;
  reliable: boolean | null;
  calibration_raw: JSONColumnType<object> | null;
  judge_runs: Generated<number>;
  judged_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}
// One row of the quiz_items table, as migration 0001 defines it.
export interface QuizItemsTable {
  id: Generated<string>;
  quiz_id: string;
  person_id: string;
  position: number;
  bank_version: number;
  question_id: number;
  persona_answer: string | null;
  human_answer: string | null;
  flipped: boolean;
  agree: boolean | null;
  judge_reason: string | null;
  judge_raw: JSONColumnType<object> | null;
  answered_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}
// One row of the pairs table, as migration 0001 defines it.
export interface PairsTable {
  id: Generated<string>;
  creator_person_id: string;
  joiner_person_id: string | null;
  token_hash: Bytes;
  expires_at: Timestamp;
  joined_at: NullableTimestamp;
  via_directory: Generated<boolean>;
  created_at: GeneratedTimestamp;
}
// One row of the meetings table, as migration 0001 defines it.
export interface MeetingsTable {
  id: Generated<string>;
  pair_id: string;
  question_id: number | null;
  question_text: string;
  question_checked_at: NullableTimestamp;
  question_rejected_reason: string | null;
  question_kind: Generated<
    "get_along" | "help" | "situation" | "decision" | "deal" | "debate" | "romance"
  >;
  romance_allowed: Generated<boolean>;
  state: Generated<"ready" | "queued" | "running" | "ended" | "deleted">;
  queue_position: number | null;
  phase: "open" | "explore" | "decide" | "close" | null;
  current_step_seq: Generated<number>;
  started_at: NullableTimestamp;
  ends_at: NullableTimestamp;
  ended_at: NullableTimestamp;
  end_reason: "decided" | "budget" | "deleted" | null;
  created_at: GeneratedTimestamp;
}
// One row of the meeting_members table, as migration 0001 defines it.
export interface MeetingMembersTable {
  meeting_id: string;
  person_id: string;
  side: "a" | "b";
  card_id: string;
  ready_at: NullableTimestamp;
  last_seen_at: NullableTimestamp;
  frozen_prefix: string | null;
  frozen_prefix_tokens: number | null;
  public_only: Generated<boolean>;
  created_at: GeneratedTimestamp;
}
// One row of the meeting_steps table, as migration 0001 defines it.
export interface MeetingStepsTable {
  id: Generated<string>;
  meeting_id: string;
  step_seq: number;
  side: "a" | "b";
  phase: "open" | "explore" | "decide";
  state: Generated<"pending" | "running" | "stalled" | "done">;
  attempt: Generated<number>;
  tool_rounds: Generated<number>;
  messages: Generated<JSONColumnType<unknown[]>>;
  partial_text: Generated<string>;
  partial_len: Generated<number>;
  first_token_at: NullableTimestamp;
  claimed_at: NullableTimestamp;
  finished_at: NullableTimestamp;
  output: JSONColumnType<object> | null;
  created_at: GeneratedTimestamp;
}
// One row of the meeting_events table, as migration 0001 defines it.
export interface MeetingEventsTable {
  id: Generated<string>;
  meeting_id: string;
  seq: number;
  type: string;
  v: number;
  payload: JSONColumnType<Record<string, unknown>>;
  created_at: GeneratedTimestamp;
}
// One row of the claims table, as migration 0001 defines it.
export interface ClaimsTable {
  id: Generated<string>;
  meeting_id: string;
  step_seq: number;
  side: "a" | "b";
  person_id: string;
  position: number;
  text: string;
  quote: string;
  gloss: string | null;
  lang: string;
  turn_id: string;
  verified: boolean;
  flagged: boolean;
  regenerated: Generated<boolean>;
  evidence_valid: boolean;
  created_at: GeneratedTimestamp;
}
// One row of the briefs table, as migration 0001 defines it.
export interface BriefsTable {
  id: Generated<string>;
  meeting_id: string;
  person_id: string;
  agree: JSONColumnType<unknown[]>;
  clash: JSONColumnType<unknown[]>;
  decide_first: JSONColumnType<unknown[]>;
  model: string;
  prompt_version: string;
  support_checked_at: NullableTimestamp;
  support_rate: ColumnType<string | null, number | string | null, number | string | null>;
  support_reliable: boolean | null;
  support_raw: JSONColumnType<object> | null;
  created_at: GeneratedTimestamp;
}
// One row of the comics table, as migration 0001 defines it.
export interface ComicsTable {
  id: Generated<string>;
  meeting_id: string;
  requested_by: string;
  state: "rendering" | "ready" | "failed" | "skipped";
  avatar_a: string;
  avatar_b: string;
  prompt_version: string;
  purge_after: Timestamp;
  finished_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}
// One row of the comic_panels table, as migration 0001 defines it.
export interface ComicPanelsTable {
  id: Generated<string>;
  comic_id: string;
  meeting_id: string;
  position: number;
  caption: string;
  image_prompt: string;
  image: Bytes;
  created_at: GeneratedTimestamp;
}
// One row of the share_pages table, as migration 0001 defines it.
export interface SharePagesTable {
  id: Generated<string>;
  meeting_id: string;
  slug: string;
  consent_a: Generated<boolean>;
  consent_b: Generated<boolean>;
  published: Generated<boolean>;
  snapshot: JSONColumnType<object> | null;
  published_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}
// One row of the ledger table, as migration 0001 defines it.
export interface LedgerTable {
  id: Generated<string>;
  person_id: string | null;
  meeting_id: string | null;
  call_site: string;
  model: string;
  effort: "minimal" | "low" | "medium";
  est_tokens: number;
  prompt_tokens: number | null;
  cached_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  usd: ColumnType<string | null, number | string | null, number | string | null>;
  status: "started" | "ok" | "error" | "timeout" | "refused";
  http_status: number | null;
  request_id: string | null;
  llm_mode: "live" | "record" | "replay";
  started_at: GeneratedTimestamp;
  finished_at: NullableTimestamp;
}
// One row of the deletions table, as migration 0001 defines it.
export interface DeletionsTable {
  id: Generated<string>;
  person_id: string;
  requested_at: Timestamp;
  completed_at: NullableTimestamp;
  counts: JSONColumnType<Record<string, number>> | null;
}
// One row of the service_heartbeats table, as migration 0001 defines it.
export interface ServiceHeartbeatsTable {
  service: "worker";
  seen_at: Timestamp;
  schema_version: number;
}
// One row of the schema_migrations table, as migration 0001 defines it.
export interface SchemaMigrationsTable {
  number: number;
  name: string;
  applied_at: GeneratedTimestamp;
}
// One row of the names_passes table, as migration 0002 defines it.
export interface NamesPassesTable {
  source_id: string;
  person_id: string;
  finished_at: GeneratedTimestamp;
}
// One row of the source_names table, as migration 0002 defines it.
export interface SourceNamesTable {
  id: Generated<string>;
  source_id: string;
  person_id: string;
  text: string;
  role_token: string;
  is_minor: Generated<boolean>;
  placeholder_ids: Generated<string[]>;
  created_at: GeneratedTimestamp;
}
// One row of the directory_listings table, as migration 0006 defines it.
export interface DirectoryListingsTable {
  id: Generated<string>;
  person_id: string;
  card_id: string;
  line: string;
  open_to_romance: Generated<boolean>;
  created_at: GeneratedTimestamp;
}
// One row of the persona_asks table, as migration 0006 defines it.
export interface PersonaAsksTable {
  id: Generated<string>;
  person_id: string;
  mode: "help" | "react" | "self";
  pair_id: string | null;
  text: string;
  state: Generated<"checking" | "asking" | "ranking" | "done" | "refused" | "failed">;
  refused_reason: string | null;
  about_name: string | null;
  question_kind:
    | "get_along"
    | "help"
    | "situation"
    | "decision"
    | "deal"
    | "debate"
    | "romance"
    | null;
  created_at: GeneratedTimestamp;
  finished_at: NullableTimestamp;
}
// One row of the persona_answers table, as migration 0006 defines it; claims is jsonb.
export interface PersonaAnswersTable {
  id: Generated<string>;
  ask_id: string;
  asker_person_id: string;
  subject_person_id: string;
  subject_card_id: string | null;
  listing_id: string | null;
  mode: "help" | "react" | "self";
  ask_text: string;
  asker_display_name: string;
  subject_display_name: string;
  subject_line: string | null;
  shortlist_rank: number;
  state: Generated<"pending" | "answered" | "failed">;
  answer: string | null;
  has_sign: boolean | null;
  claims: JSONColumnType<unknown[], string | undefined>;
  supported_count: number | null;
  position: number | null;
  created_at: GeneratedTimestamp;
  answered_at: NullableTimestamp;
}
// One row of the friend_requests table, as migration 0008 defines it.
export interface FriendRequestsTable {
  id: Generated<string>;
  from_person_id: string;
  to_person_id: string;
  state: Generated<"pending" | "accepted" | "declined">;
  pair_id: string | null;
  created_at: GeneratedTimestamp;
  decided_at: NullableTimestamp;
}
// One row of the orchestrator_messages table, as migration 0008 defines it; friends_snapshot is jsonb.
export interface OrchestratorMessagesTable {
  id: Generated<string>;
  person_id: string;
  role: "you" | "agent";
  text: string;
  state: Generated<"thinking" | "planned" | "running" | "done" | "failed">;
  action: "help" | "react" | "reply" | null;
  action_question: string | null;
  action_friend_name: string | null;
  action_pair_id: string | null;
  ask_id: string | null;
  friends_snapshot: JSONColumnType<unknown[], string | undefined>;
  reply_to: string | null;
  created_at: GeneratedTimestamp;
}
// One row of the posts table, as migrations 0009 and 0013 define it: a post or a story, with its photo as JPEG bytes.
export interface PostsTable {
  id: Generated<string>;
  person_id: string;
  text: string;
  created_at: GeneratedTimestamp;
  kind: Generated<"post" | "story">;
  photo: ColumnType<Buffer | null, Buffer | null | undefined, Buffer | null>;
  expires_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}
// One row of the google_accounts table, as migration 0015 defines it: the Google account a person signs in with, by its subject only.
export interface GoogleAccountsTable {
  google_sub: string;
  person_id: string;
  created_at: GeneratedTimestamp;
}
// One row of the person_summaries table, as migration 0016 defines it: the summary a person's own AI wrote; points is jsonb.
export interface PersonSummariesTable {
  person_id: string;
  text: string;
  points: JSONColumnType<unknown[], string | undefined>;
  state: Generated<"checking" | "ready" | "failed">;
  friends_can_ask: Generated<boolean>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}
// One row of the post_likes table, as migration 0013 defines it: a post a person liked.
export interface PostLikesTable {
  post_id: string;
  person_id: string;
  created_at: GeneratedTimestamp;
}
// One row of the profile_photos table, as migration 0012 defines it: a person's own photo as JPEG bytes.
export interface ProfilePhotosTable {
  id: Generated<string>;
  person_id: string;
  image: Buffer;
  created_at: GeneratedTimestamp;
}
// One row of the recall_corpus view, as migration 0001 defines it.
export interface RecallCorpusView {
  turn_id: string;
  person_id: string;
  source_id: string;
  text: string;
  norm_text: string;
  card_id: string;
}

// Every table and view of migrations 0001 to 0015, by its SQL name. Add a row here in the same change that adds a migration.
export interface Database {
  people: PeopleTable;
  sessions: SessionsTable;
  transfer_links: TransferLinksTable;
  sources: SourcesTable;
  turns: TurnsTable;
  redactions: RedactionsTable;
  cards: CardsTable;
  card_items: CardItemsTable;
  quiz_bank: QuizBankTable;
  quizzes: QuizzesTable;
  quiz_items: QuizItemsTable;
  pairs: PairsTable;
  meetings: MeetingsTable;
  meeting_members: MeetingMembersTable;
  meeting_steps: MeetingStepsTable;
  meeting_events: MeetingEventsTable;
  claims: ClaimsTable;
  briefs: BriefsTable;
  comics: ComicsTable;
  comic_panels: ComicPanelsTable;
  share_pages: SharePagesTable;
  ledger: LedgerTable;
  deletions: DeletionsTable;
  service_heartbeats: ServiceHeartbeatsTable;
  schema_migrations: SchemaMigrationsTable;
  names_passes: NamesPassesTable;
  source_names: SourceNamesTable;
  recall_corpus: RecallCorpusView;
  directory_listings: DirectoryListingsTable;
  persona_asks: PersonaAsksTable;
  persona_answers: PersonaAnswersTable;
  friend_requests: FriendRequestsTable;
  orchestrator_messages: OrchestratorMessagesTable;
  posts: PostsTable;
  post_likes: PostLikesTable;
  profile_photos: ProfilePhotosTable;
  google_accounts: GoogleAccountsTable;
  person_summaries: PersonSummariesTable;
}

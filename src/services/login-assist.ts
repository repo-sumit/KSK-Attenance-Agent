/**
 * LoginAssist — an optional list of accounts on the first login screen.
 *
 * The demo layer supplies one (its demo accounts, from demo data); production
 * builds pass none, so the login screens render nothing extra and route
 * exactly as typed codes do. Nothing happens until the user taps an account.
 * A pick may then advance through the input steps (the institute code and the
 * Trainer ID are looked up for the user), but the configured confirmation
 * steps ("Is this your institute?", "Is this you?") are never skipped.
 */
export interface LoginCredentials {
  readonly instituteCode: string;
  readonly trainerId: string;
  /** Who the credentials belong to, e.g. "Dr. Anil Deshmukh · Principal". */
  readonly who: string;
}

export interface LoginAssistOption {
  readonly id: string;
  /** The account's role, the row's title, e.g. "Principal". */
  readonly label: string;
  /** The person, e.g. "Dr. Anil Deshmukh". */
  readonly who: string;
  /** What the account shows, e.g. "Institute · corrections · staff". */
  readonly line: string;
}

/** Everything the helper shows. The source supplies all its text (demo tooling is English-only). */
export interface LoginAssist {
  /** The list's title, e.g. "Demo accounts". */
  readonly heading: string;
  /** One line under the title on what a tap does. */
  readonly hint: string;
  readonly options: readonly LoginAssistOption[];
  /** An option to highlight (e.g. the one the presenter picked elsewhere). Highlighted only: never picked. */
  readonly suggested: string | null;
}

export interface LoginAssistSource {
  /** Referentially stable while nothing changed (read with useSyncExternalStore). */
  get(): LoginAssist | null;
  subscribe(listener: () => void): () => void;
  /** The user picked an account: the source gets it ready and returns its credentials (null for an unknown id). */
  choose(id: string): Promise<LoginCredentials | null>;
  /** The credentials of an account picked earlier in this login, for a later step (null for an unknown id). */
  credentials(id: string): LoginCredentials | null;
}

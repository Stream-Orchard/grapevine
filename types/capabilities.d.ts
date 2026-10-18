// Generated from schemas/ by scripts/types.js. Don't edit it: change a schema and run `npm run types`.

/** ISO 8601, in UTC */
export type Timestamp = string;

/** A streaming site */
export type Platform = "kick" | "twitch" | "youtube" | (string & {});

export type Channel = {
  platform: Platform;
  /** As in the channel's address */
  slug: string;
  /** As shown on the site */
  name?: string;
};

/** Who an app is signed in as: the username only, never a token or cookie */
export type Account = {
  platform: Platform;
  user: string;
};

export type Progress = {
  done: number;
  total: number;
  unit: "minutes" | (string & {});
};

export type Empty = Record<string, unknown>;

// drops.farming 1.0: What a drops app is farming. Provided by Pear Drops.
export type DropsFarmingV1State = {
  /** Counts up with each change; 0 for a reply to drops.farming.get */
  seq: number;
  at: Timestamp;
  /** farming: its player is watching a stream for drop credit. Any other value, known or not, means it isn't. */
  state: "farming" | "waiting" | "paused" | "done" | "signed-out" | (string & {});
  account: Account | null;
  /** The stream being watched, while farming */
  channel: Channel | null;
  drop: {
    campaign: string;
    category: string;
    progress: Progress;
  } | null;
};

// players 1.0: An app's stream players, by site: whether they're signed in, and which channels are open. Provided by Stream Multiview.
export type PlayersV1State = {
  seq: number;
  at: Timestamp;
  /** Keyed by Platform; a site with no players open may be left out */
  platforms: {
    [key: string]: PlayersV1Site;
  };
};

export type PlayersV1Site = {
  /** Whether the players play as the account right now */
  signedIn: boolean;
  /** auto: signed in, except while a connected drops app is farming */
  mode: "signed-in" | "signed-out" | "auto" | (string & {});
  account: Account | null;
  open: Array<Channel>;
};

/** Every event, by name: its params. */
export interface Events {
  "drops.farming.changed": DropsFarmingV1State;
  "players.changed": PlayersV1State;
}

/** Every method, by name: its params and result. */
export interface Methods {
  "drops.farming.get": { params: Empty; result: DropsFarmingV1State };
  "players.get": { params: Empty; result: PlayersV1State };
}

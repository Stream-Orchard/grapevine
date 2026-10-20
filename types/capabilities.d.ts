// Generated from schemas/ by scripts/types.js. Don't edit it: change a schema and run `npm run types`.

/** ISO 8601, in UTC */
export type Timestamp = string;

/** A picture's https address, as the site gives it */
export type Image = string;

/** A streaming site */
export type Platform = "kick" | "twitch" | "youtube" | (string & {});

export type Channel = {
  platform: Platform;
  /** As in the channel's address */
  slug: string;
  /** As shown on the site */
  name?: string;
  /** The channel's picture */
  avatar?: Image;
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

// drops.farming 1.0: What a drops app is farming, with enough to show it (a top-bar widget, say). Provided by Pear Drops.
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
    /** The category's picture */
    image?: Image;
    /** When the drop ends */
    endsAt?: Timestamp;
    /** When every reward should be earned, at the current rate */
    doneAt?: Timestamp | null;
    rewards?: {
      claimed: number;
      total: number;
      /** Every reward of the drop, in the order they unlock */
      items?: Array<DropsFarmingV1Reward>;
    };
    /** The reward being worked towards */
    next?: {
      name: string;
      image?: Image;
      /** Minutes of watching it unlocks at */
      required: number;
      /** When it should unlock, at the current rate */
      unlocksAt?: Timestamp | null;
    } | null;
  } | null;
  /** The stream being watched, while farming: its title and viewers */
  stream?: {
    title?: string;
    viewers?: number;
  } | null;
};

export type DropsFarmingV1Reward = {
  name: string;
  image?: Image;
  /** Minutes of watching it unlocks at */
  required: number;
  /** ready: unlocked, waiting to be claimed */
  state: "claimed" | "ready" | "locked" | (string & {});
  /** For a locked one: when it should unlock, at the current rate */
  unlocksAt?: Timestamp | null;
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

// rewards.daily 1.0: A daily reward: watch for an hour a day, then claim it. Enough to show where it's at (a toolbar chest, say) and to ask the app that tracks it to bring it forward. Provided by Pear Drops, for Kick's Daily Reward.
export type RewardsDailyV1State = {
  /** Counts up with each change; 0 for a reply to rewards.daily.get */
  seq: number;
  at: Timestamp;
  /** earning: the hour is being watched; ready: waiting to be claimed; claimed: done for today. Any other value, known or not, means there's nothing to show. */
  state: "earning" | "ready" | "claimed" | "unavailable" | "signed-out" | (string & {});
  /** The account the reward belongs to */
  account: Account | null;
  /** Minutes watched today, while earning */
  minutes?: number;
  /** Minutes it takes (60 on Kick) */
  threshold?: number;
  /** When today's reward resets (midnight UTC on Kick) */
  endsAt?: Timestamp | null;
};

/** Every event, by name: its params. */
export interface Events {
  "drops.farming.changed": DropsFarmingV1State;
  "players.changed": PlayersV1State;
  "rewards.daily.changed": RewardsDailyV1State;
}

/** Every method, by name: its params and result. */
export interface Methods {
  "drops.farming.get": { params: Empty; result: DropsFarmingV1State };
  "drops.farming.show": { params: Empty; result: {
      /** Whether its window came to the front */
      shown: boolean;
    } };
  "players.get": { params: Empty; result: PlayersV1State };
  "rewards.daily.get": { params: Empty; result: RewardsDailyV1State };
  "rewards.daily.show": { params: Empty; result: {
      /** Whether its window came to the front, with the daily reward open */
      shown: boolean;
    } };
}

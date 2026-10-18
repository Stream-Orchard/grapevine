// The types of what an app calls. The message types come from the schemas (capabilities.d.ts).
import { EventEmitter } from 'events';
import type { Events, Methods } from './capabilities';

export * from './capabilities';

/** Which events and methods there are, and what they hold, comes from the schemas. */
export type EventName = keyof Events;
export type MethodName = keyof Methods;
/** An event's own fields: `seq` and `at` are added by publish(). */
export type EventData<E extends EventName> = Omit<Events[E], 'seq' | 'at'>;

export interface AppInfo {
  /** The app's install id, like com.example.app */
  id: string;
  /** Its socket name: a-z, 0-9 and dashes */
  slug: string;
  name: string;
  version: string;
  summary?: string;
  /** A PNG data URL, or the path of a PNG file */
  icon?: string;
  homepage?: string;
  download?: string;
}

export interface KeyStore {
  /** Whether keys are encrypted at rest */
  encrypted?: boolean;
  get(appId: string): { key: string; pairedAt?: string } | null;
  set(appId: string, key: string): void;
  delete(appId: string): void;
}

export interface Place {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  uid?: number;
}

export interface Timing {
  handshakeMs: number;
  pingMs: number;
  pongMs: number;
  rateMax: number;
  strikes: number;
  pollMs: number;
  backoffMs: number[];
}

export interface KnownApp {
  id: string;
  slug: string;
  name: string;
  summary: string;
  /** A bundled 256×256 PNG */
  icon: string;
  homepage: string;
  download: string;
  /** Its folder in the OS's app data folder */
  dataFolder: string;
  /** "capability@major.minor" (or "protocol@N") -> the app version that first had it */
  firstRelease: Record<string, string>;
}

export interface LinkOptions {
  app: AppInfo;
  /** Capabilities this app provides, e.g. { 'drops.farming': '1.0' } */
  provides?: Record<string, string | string[]>;
  /** Capabilities this app uses, e.g. { players: '1.0' } */
  uses?: Record<string, string | string[]>;
  /** Whether its Connected apps switch for that app is on */
  allowed: (appId: string) => boolean;
  /** Where pairing keys are kept: fileKeyStore() (in memory if left out) */
  keys?: KeyStore;
  /** The OS's app data folder, to tell whether known apps are installed */
  appDataDir?: string;
  place?: Place;
  schemaDirs?: string[];
  knownApps?: KnownApp[];
  timing?: Partial<Timing>;
  /** Throw on a message that doesn't fit its schema (default: when NODE_ENV is "test") */
  strict?: boolean;
  log?: (level: 'info' | 'warn' | 'error', text: string) => void;
}

export interface Report {
  state: 'works' | 'limited' | 'incompatible';
  missing: { capability: string; update: { app: string; appId: string; version: string | null } }[];
  update?: { app: string; appId: string; version: string | null };
  /** One line for the card, e.g. "Works, with a feature missing: update Pear Drops to 0.1.7 or later" */
  text: string;
}

export interface Peer {
  id: string;
  name: string;
  summary: string;
  /** Path of its bundled logo */
  icon: string;
  homepage: string;
  download: string;
  /** Whether it looks installed; null without appDataDir */
  installed: boolean | null;
  /** Whether this app's switch for it is on */
  enabled: boolean;
  status: 'off' | 'waiting' | 'connected' | 'pair-again' | 'incompatible';
  /** e.g. 'switched-off' (its own switch is off), 'disconnected-there' */
  reason: string | null;
  /** For 'pair-again': which app holds the old key, so where to press Pair again */
  keyHeldBy: 'us' | 'them' | null;
  /** Its version, while connected */
  version: string | null;
  report: Report | null;
  pairedAt: string | null;
  keysEncrypted: boolean;
}

export interface CallContext {
  appId: string;
  app: AppInfo;
  major: number;
}

export declare class Link extends EventEmitter {
  constructor(opts: LinkOptions);
  /** Listens for other apps and starts looking for them. */
  start(): Promise<void>;
  /** Says goodbye to every app and stops listening. */
  stop(): Promise<void>;
  /** Call after a Connected apps switch changes. */
  refresh(): void;
  /** Tells every subscribed app something changed; returns the params as sent. */
  publish<E extends EventName>(event: E, data: EventData<E>): Events[E];
  publish(event: string, data: Record<string, unknown>): Record<string, unknown>;
  /** Answers a method of a capability this app provides. */
  handle<M extends MethodName>(method: M, fn: (params: Methods[M]['params'], ctx: CallContext) => Methods[M]['result'] | Promise<Methods[M]['result']>): void;
  handle(method: string, fn: (params: any, ctx: CallContext) => unknown): void;
  /** Asks a connected app something. */
  request<M extends MethodName>(appId: string, method: M, params?: Methods[M]['params'], opts?: { timeout?: number }): Promise<Methods[M]['result']>;
  request(appId: string, method: string, params?: Record<string, unknown>, opts?: { timeout?: number }): Promise<unknown>;
  /** Disconnect on a card: both apps forget the pairing. Switch this app's own setting off too. */
  disconnect(appId: string): Promise<void>;
  /** Pair again on a card: forgets this app's old key. */
  pairAgain(appId: string): void;
  isConnected(appId: string): boolean;
  /** Every known app, for the Connected apps page. */
  peers(): Peer[];

  on(event: 'event', listener: <E extends EventName>(from: string, name: E, params: Events[E]) => void): this;
  on(event: 'connected', listener: (appId: string) => void): this;
  on(event: 'disconnected', listener: (appId: string, reason: string) => void): this;
  on(event: 'unpaired', listener: (appId: string) => void): this;
  on(event: 'change', listener: () => void): this;
  on(event: 'log', listener: (level: 'info' | 'warn' | 'error', text: string) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

export declare function createLink(opts: LinkOptions): Link;

export declare class GrapevineError extends Error {
  constructor(code: number, message: string, data?: unknown);
  code: number;
  data: unknown;
  toJSON(): { code: number; message: string; data?: unknown };
}

export declare const CODES: Readonly<{
  PARSE_ERROR: -32700;
  INVALID_REQUEST: -32600;
  METHOD_NOT_FOUND: -32601;
  INVALID_PARAMS: -32602;
  INTERNAL_ERROR: -32603;
  NOT_PAIRED: -32001;
  NOT_AGREED: -32002;
  UNSUPPORTED: -32003;
  TOO_MANY: -32004;
  SWITCHED_OFF: -32005;
  CLOSED: -32099;
  TIMEOUT: -32098;
}>;

export declare const PROTOCOL: { min: number; max: number };
export declare const KNOWN_APPS: KnownApp[];

/** Keys in a small file in the app's data folder, encrypted with encrypt/decrypt (e.g. Electron's safeStorage) when given. */
export declare function fileKeyStore(file: string, crypt?: { encrypt?: (text: string) => string; decrypt?: (stored: string) => string }): KeyStore;
export declare function memoryKeyStore(): KeyStore;
export declare function isInstalled(app: KnownApp, appDataDir: string): boolean;
export declare function iconDataUrl(file: string): string;

export declare const paths: {
  linkDir(place?: Place): string;
  socketDir(place?: Place): string;
  socketPath(slug: string, place?: Place): string;
  listSlugs(place?: Place): string[];
};

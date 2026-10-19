// The keys on the Stream Deck: each one's settings, presses and picture.
// Kept apart from the Stream Deck SDK (see plugin.ts) so it can be tested.

import {
  DOUBLE_MS,
  findInput,
  heldMove,
  HOLD_MS,
  needsHold,
  ptzRequest,
  request,
  type GlobalSettings,
  type KeySettings,
  type Kind,
  type Request,
} from './actions';
import { dataUrl, keyModel, renderSvg } from './keys';
import { Gesture } from './press';
import { DEFAULT_ADDRESS, type LumoraClient, type SendResult, type Timers, realTimers } from './protocol';
import type { ScreenId } from './show';
import { dialFeedback, dialPush, dialRotate, dialTouch, type DialKind, type DialSettings, type Feedback } from './dials';

/** What the deck does to the Stream Deck app. */
export interface Surface {
  setImage(id: string, image: string): void;
  showAlert(id: string): void;
  showOk(id: string): void;
  saveGlobal(settings: GlobalSettings): void;
  /** Stream Deck +: what the touch strip shows above a dial. */
  setFeedback?(id: string, feedback: Feedback): void;
}

interface Dial {
  id: string;
  kind: DialKind;
  settings: DialSettings;
  /** A value just sent (shown, and turned from) until Lumora's own comes back. */
  pending: number | null;
  pendingAt: number;
  /** The feedback last sent (only changes are sent). */
  shown: string;
}

/** How long a value just sent wins over Lumora's (which is a moment behind while turning). */
const PENDING_MS = 700;

interface Key {
  id: string;
  kind: Kind;
  settings: KeySettings;
  gesture: Gesture;
  hold: number | null;
  /** The picture last sent (only changes are sent). */
  image: string;
}

/** Lists for the property inspector's pickers. */
export interface Lists {
  connection: string;
  address: string;
  inputs: { id: string; name: string; number: number; ptz: boolean }[];
  presets: { id: string; name: string; number: number }[];
  macros: { id: string; name: string; number: number }[];
  overlays: { channel: number; name: string | null }[];
  countdowns: { id: string; name: string }[];
  slideshows: { id: string; name: string }[];
}

/** How often input keys' pictures are fetched. */
export const PICTURE_MS = 1000;
/** A picture not refreshed for this long is dropped (the input went, or Lumora stopped drawing it). */
export const PICTURE_STALE_MS = 6000;

/** Keys whose request runs in Lumora's control window. */
const APP_KINDS: ReadonlySet<Kind> = new Set(['record', 'golive', 'rehearsal', 'replay']);

export class Deck {
  private readonly keys = new Map<string, Key>();
  private readonly dials = new Map<string, Dial>();
  private global: GlobalSettings = {};
  private ticker: unknown = null;
  /** Each input's newest picture (a `data:` URL) and when it came. */
  private readonly pictures = new Map<string, { url: string; at: number }>();
  private pictureTimer: unknown = null;
  private fetching = false;
  private readonly timers: Timers;

  constructor(
    private readonly client: LumoraClient,
    private readonly surface: Surface,
    timers?: Timers,
  ) {
    this.timers = timers ?? realTimers;
    client.subscribe(() => {
      this.drawAll();
      this.problems();
    });
  }

  /** The last problem the control window reported, already shown. */
  private seenError: number | null | undefined = undefined;

  /** Lumora could not do what a key asked (no stream destination…): flash those keys. */
  private problems(): void {
    const state = this.client.state;
    if (!state) return;
    const at = state.app.error?.at ?? null;
    if (at === this.seenError) return;
    // One from before the Stream Deck connected is old news.
    const first = this.seenError === undefined;
    this.seenError = at;
    if (first || at === null) return;
    for (const k of this.keys.values()) if (APP_KINDS.has(k.kind)) this.surface.showAlert(k.id);
  }

  get screen(): ScreenId {
    return this.global.screen === 'back' ? 'back' : 'live';
  }

  /** The plugin-wide settings arrived or changed. */
  setGlobal(settings: GlobalSettings): void {
    this.global = { ...settings };
    this.client.configure(settings.address || DEFAULT_ADDRESS, settings.pin);
    this.drawAll();
  }

  /** A key came onto the Stream Deck (or its settings changed). */
  appear(id: string, kind: Kind, settings: KeySettings): void {
    const known = this.keys.get(id);
    if (known) {
      known.kind = kind;
      known.settings = { ...settings };
      this.draw(known);
      this.tick();
      return;
    }
    const key: Key = { id, kind, settings: { ...settings }, hold: null, image: '', gesture: null as unknown as Gesture };
    key.gesture = new Gesture(
      {
        press: () => void this.fire(key, 'press'),
        double: () => void this.fire(key, 'double'),
        progress: (p) => {
          key.hold = p;
          this.draw(key);
        },
        cancelled: () => this.surface.showAlert(key.id),
      },
      {
        holdMs: () => (needsHold(key.kind, key.settings, this.client.state) ? HOLD_MS : 0),
        // Input keys: the first press lines it up in Next, a second press cuts it to air.
        doubleMs: kind === 'input' ? DOUBLE_MS : 0,
        timers: this.timers,
      },
    );
    this.keys.set(id, key);
    this.draw(key);
    this.tick();
  }

  disappear(id: string): void {
    this.keys.get(id)?.gesture.reset();
    this.keys.delete(id);
    this.tick();
  }

  keyDown(id: string): void {
    const k = this.keys.get(id);
    if (!k) return;
    // PTZ moves last while the key is held.
    if (heldMove(k.kind, k.settings)) {
      void this.sendKey(k, ptzRequest(k.settings, this.client.state, 'start'));
      return;
    }
    k.gesture.keyDown();
  }

  keyUp(id: string): void {
    const k = this.keys.get(id);
    if (!k) return;
    if (heldMove(k.kind, k.settings)) {
      void this.sendKey(k, ptzRequest(k.settings, this.client.state, 'stop'));
      return;
    }
    k.gesture.keyUp();
  }

  /** Send a key's request now (PTZ moves); a refusal flashes the key. */
  private async sendKey(k: Key, r: Request): Promise<void> {
    if (r.to === 'none') {
      this.surface.showAlert(k.id);
      return;
    }
    const result = await this.dispatch(r);
    if (result && !result.ok && !result.duplicate) this.surface.showAlert(k.id);
  }

  /** Send a request where it goes (null: nothing to send). */
  private dispatch(r: Request): Promise<SendResult> | null {
    if (r.to === 'action') return this.client.action(r.body);
    if (r.to === 'app') return this.client.command(r.body);
    if (r.to === 'do') return this.client.run(r.command, r.query);
    return null;
  }

  // ---- input pictures ----

  /** The inputs whose keys show their picture now. */
  private pictureInputs(): string[] {
    const state = this.client.state;
    if (!state || this.client.connection !== 'online') return [];
    const ids = new Set<string>();
    for (const k of this.keys.values()) {
      if (k.kind !== 'input' || k.settings.picture === false) continue;
      const input = findInput(state, k.settings);
      if (input) ids.add(input.id);
    }
    return [...ids];
  }

  /** Fetch the pictures every second while any key shows one (one round at a time). */
  private picturesTick(): void {
    const wanted = [...this.keys.values()].some((k) => k.kind === 'input' && k.settings.picture !== false);
    if (wanted && this.pictureTimer === null) {
      const loop = () => {
        this.pictureTimer = this.timers.set(() => {
          void this.fetchPictures().finally(loop);
        }, PICTURE_MS);
      };
      loop();
    } else if (!wanted && this.pictureTimer !== null) {
      this.timers.clear(this.pictureTimer);
      this.pictureTimer = null;
      this.pictures.clear();
    }
  }

  /** One round: each shown input's newest picture, then the keys redrawn. */
  async fetchPictures(): Promise<void> {
    if (this.fetching) return;
    this.fetching = true;
    try {
      const ids = this.pictureInputs();
      const now = this.timers.now();
      const got = await Promise.all(ids.map(async (id) => [id, await this.client.picture(id)] as const));
      for (const [id, url] of got) if (url) this.pictures.set(id, { url, at: now });
      for (const [id, p] of this.pictures) if (!ids.includes(id) || now - p.at > PICTURE_STALE_MS) this.pictures.delete(id);
      for (const k of this.keys.values()) if (k.kind === 'input') this.draw(k);
    } finally {
      this.fetching = false;
    }
  }

  /** Redraw every key (Lumora's state changed). */
  drawAll(): void {
    for (const k of this.keys.values()) this.draw(k);
    for (const d of this.dials.values()) this.drawDial(d);
  }

  // ---- Stream Deck + dials ----

  dialAppear(id: string, kind: DialKind, settings: DialSettings): void {
    const known = this.dials.get(id);
    const d: Dial = known ?? { id, kind, settings: {}, pending: null, pendingAt: 0, shown: '' };
    d.kind = kind;
    d.settings = { ...settings };
    this.dials.set(id, d);
    d.shown = '';
    this.drawDial(d);
  }

  dialDisappear(id: string): void {
    this.dials.delete(id);
  }

  private pendingOf(d: Dial): number | null {
    return d.pending !== null && this.timers.now() - d.pendingAt < PENDING_MS ? d.pending : null;
  }

  async dialRotate(id: string, ticks: number): Promise<void> {
    const d = this.dials.get(id);
    if (!d) return;
    const r = dialRotate(d.kind, d.settings, this.client.state, this.screen, ticks, this.pendingOf(d) ?? undefined);
    if (r.request.to === 'none') {
      this.surface.showAlert(id);
      return;
    }
    d.pending = r.value;
    d.pendingAt = this.timers.now();
    this.drawDial(d);
    await this.send(id, r.request);
    // Once Lumora's value is back, show it.
    this.timers.set(() => this.drawDial(d), PENDING_MS + 50);
  }

  async dialPush(id: string): Promise<void> {
    const d = this.dials.get(id);
    if (d) await this.send(id, dialPush(d.kind, d.settings, this.client.state, this.screen));
  }

  async dialTouch(id: string): Promise<void> {
    const d = this.dials.get(id);
    if (d) await this.send(id, dialTouch(d.kind, d.settings, this.client.state, this.screen));
  }

  private async send(id: string, r: Request): Promise<void> {
    if (r.to === 'none' || r.to === 'screen') {
      if (r.to === 'none') this.surface.showAlert(id);
      return;
    }
    const result = await this.dispatch(r);
    if (result && !result.ok && !result.duplicate) this.surface.showAlert(id);
  }

  private drawDial(d: Dial): void {
    if (!this.surface.setFeedback) return;
    const fb = dialFeedback(d.kind, d.settings, this.client.state, this.screen, this.client.connection, this.pendingOf(d));
    const text = JSON.stringify(fb);
    if (text === d.shown) return;
    d.shown = text;
    this.surface.setFeedback(d.id, fb);
  }

  private draw(k: Key): void {
    const state = this.client.state;
    const input = k.kind === 'input' && state ? findInput(state, k.settings) : undefined;
    const model = keyModel(k.kind, k.settings, {
      state,
      connection: this.client.connection,
      deck: this.screen,
      now: this.client.now(),
      hold: k.hold,
      picture: input ? (this.pictures.get(input.id)?.url ?? null) : null,
    });
    const image = dataUrl(renderSvg(model));
    if (image === k.image) return;
    k.image = image;
    this.surface.setImage(k.id, image);
  }

  /** Countdown keys count down by themselves: redraw them every second while any is shown. */
  private tick(): void {
    this.picturesTick();
    const any = [...this.keys.values()].some((k) => k.kind === 'countdown');
    if (any && this.ticker === null) {
      const loop = () => {
        this.ticker = this.timers.set(() => {
          for (const k of this.keys.values()) if (k.kind === 'countdown') this.draw(k);
          loop();
        }, 250);
      };
      loop();
    } else if (!any && this.ticker !== null) {
      this.timers.clear(this.ticker);
      this.ticker = null;
    }
  }

  /** What a press does, sent once. */
  private async fire(key: Key, gesture: 'press' | 'double'): Promise<Request> {
    const r = request(key.kind, key.settings, this.client.state, this.screen, gesture);
    if (r.to === 'screen') {
      this.global = { ...this.global, screen: r.screen };
      this.surface.saveGlobal(this.global);
      this.drawAll();
      return r;
    }
    if (r.to === 'none') {
      this.surface.showAlert(key.id);
      return r;
    }
    const result = await this.dispatch(r);
    if (!result || result.duplicate) return r;
    if (!result.ok) this.surface.showAlert(key.id);
    return r;
  }

  /** For the property inspector's pickers. */
  lists(): Lists {
    const s = this.client.state;
    return {
      connection: this.client.connection,
      address: this.client.address,
      inputs: s?.inputs.map(({ id, name, number, ptz }) => ({ id, name, number, ptz })) ?? [],
      presets: s?.presets.map(({ id, name, number }) => ({ id, name, number })) ?? [],
      macros: s?.macros.map(({ id, name, number }) => ({ id, name, number })) ?? [],
      overlays: s?.overlays.map(({ channel, name }) => ({ channel, name })) ?? [1, 2, 3, 4].map((channel) => ({ channel, name: null })),
      countdowns: s?.countdowns.map(({ id, name }) => ({ id, name })) ?? [],
      slideshows: s?.slideshows.map(({ id, name }) => ({ id, name })) ?? [],
    };
  }
}

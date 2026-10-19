import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('streamdeck/src/deck.ts', [
("""import type { ScreenId } from './show';""", """import type { ScreenId } from './show';
import { dialFeedback, dialPush, dialRotate, dialTouch, type DialKind, type DialSettings, type Feedback } from './dials';"""),
("""  saveGlobal(settings: GlobalSettings): void;
}""", """  saveGlobal(settings: GlobalSettings): void;
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
const PENDING_MS = 700;"""),
("""  private readonly keys = new Map<string, Key>();""", """  private readonly keys = new Map<string, Key>();
  private readonly dials = new Map<string, Dial>();"""),
("""  /** Redraw every key (Lumora's state changed). */
  drawAll(): void {
    for (const k of this.keys.values()) this.draw(k);
  }""", """  /** Redraw every key (Lumora's state changed). */
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
    const result = r.to === 'action' ? await this.client.action(r.body) : await this.client.command(r.body);
    if (!result.ok && !result.duplicate) this.surface.showAlert(id);
  }

  private drawDial(d: Dial): void {
    if (!this.surface.setFeedback) return;
    const fb = dialFeedback(d.kind, d.settings, this.client.state, this.screen, this.client.connection, this.pendingOf(d));
    const text = JSON.stringify(fb);
    if (text === d.shown) return;
    d.shown = text;
    this.surface.setFeedback(d.id, fb);
  }"""),
])

apply('streamdeck/src/plugin.ts', [
("""import streamDeck, {
  SingletonAction,
  type DidReceiveSettingsEvent,""", """import streamDeck, {
  SingletonAction,
  type DialDownEvent,
  type DialRotateEvent,
  type TouchTapEvent,
  type DidReceiveSettingsEvent,"""),
("""import { Deck } from './deck';""", """import { Deck } from './deck';
import { DIAL_KINDS, type DialKind, type DialSettings } from './dials';"""),
("""  saveGlobal: (settings) => void streamDeck.settings.setGlobalSettings(settings as JsonObject),
});""", """  saveGlobal: (settings) => void streamDeck.settings.setGlobalSettings(settings as JsonObject),
  setFeedback: (id, fb) => {
    const a = streamDeck.actions.getActionById(id);
    if (a?.isDial()) void a.setFeedback({ title: fb.title, value: fb.value, indicator: { value: fb.indicator } });
  },
});"""),
("""for (const kind of KINDS) streamDeck.actions.registerAction(new LumoraAction(kind));""", """for (const kind of KINDS) streamDeck.actions.registerAction(new LumoraAction(kind));

/** Stream Deck + dials: the T-bar and sound faders. */
class LumoraDial extends SingletonAction {
  override readonly manifestId: string;

  constructor(private readonly kind: DialKind) {
    super();
    this.manifestId = `${PLUGIN_ID}.${kind}`;
  }

  override onWillAppear(ev: WillAppearEvent): void {
    deck.dialAppear(ev.action.id, this.kind, ev.payload.settings as DialSettings);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    deck.dialDisappear(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    deck.dialAppear(ev.action.id, this.kind, ev.payload.settings as DialSettings);
  }

  override onDialRotate(ev: DialRotateEvent): void {
    void deck.dialRotate(ev.action.id, ev.payload.ticks);
  }

  override onDialDown(ev: DialDownEvent): void {
    void deck.dialPush(ev.action.id);
  }

  override onTouchTap(ev: TouchTapEvent): void {
    void deck.dialTouch(ev.action.id);
  }

  override onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent): void {
    inspector = ev.action.id;
    sendLists();
  }

  override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent): void {
    if (inspector === ev.action.id) inspector = null;
  }

  override onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): void {
    const p = ev.payload as { event?: string } | null;
    if (p?.event === 'connect') client.restart();
    if (p?.event === 'connect' || p?.event === 'lists') sendLists();
  }
}

for (const kind of DIAL_KINDS) streamDeck.actions.registerAction(new LumoraDial(kind));"""),
("""import { KINDS, uuid, type GlobalSettings, type KeySettings, type Kind } from './actions';""",
"""import { KINDS, PLUGIN as PLUGIN_ID, uuid, type GlobalSettings, type KeySettings, type Kind } from './actions';"""),
])

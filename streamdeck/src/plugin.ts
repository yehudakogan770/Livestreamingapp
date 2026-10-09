// The Stream Deck side: Elgato's SDK hands us key presses and settings; the
// deck (deck.ts) does the rest. Built into bin/plugin.js by scripts/pack.mjs.

import streamDeck, {
  SingletonAction,
  type DialDownEvent,
  type DialRotateEvent,
  type TouchTapEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type PropertyInspectorDidAppearEvent,
  type PropertyInspectorDidDisappearEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from '@elgato/streamdeck';
import type { JsonObject, JsonValue } from '@elgato/utils';
import { KINDS, PLUGIN as PLUGIN_ID, uuid, type GlobalSettings, type KeySettings, type Kind } from './actions';
import { Deck } from './deck';
import { DIAL_KINDS, type DialKind, type DialSettings } from './dials';
import { LumoraClient } from './protocol';

const client = new LumoraClient();
const deck = new Deck(client, {
  setImage: (id, image) => void keyAction(id)?.setImage(image),
  showAlert: (id) => void keyAction(id)?.showAlert(),
  showOk: (id) => void keyAction(id)?.showOk(),
  saveGlobal: (settings) => void streamDeck.settings.setGlobalSettings(settings as JsonObject),
  setFeedback: (id, fb) => {
    const a = streamDeck.actions.getActionById(id);
    if (a?.isDial()) void a.setFeedback({ title: fb.title, value: fb.value, indicator: { value: fb.indicator } });
  },
});

function keyAction(id: string) {
  const a = streamDeck.actions.getActionById(id);
  return a?.isKey() ? a : undefined;
}

/** Keep the property inspector's pickers up to date while it is open. */
let inspector: string | null = null;
function sendLists(): void {
  if (inspector === null) return;
  void streamDeck.ui.sendToPropertyInspector({ event: 'lists', ...deck.lists() } as unknown as JsonValue);
}
client.subscribe(sendLists);

/** One class serves every key kind; each instance is registered under its own action id. */
class LumoraAction extends SingletonAction {
  override readonly manifestId: string;

  constructor(private readonly kind: Kind) {
    super();
    this.manifestId = uuid(kind);
  }

  override onWillAppear(ev: WillAppearEvent): void {
    deck.appear(ev.action.id, this.kind, ev.payload.settings as KeySettings);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    deck.disappear(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    deck.appear(ev.action.id, this.kind, ev.payload.settings as KeySettings);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    deck.keyDown(ev.action.id);
  }

  override onKeyUp(ev: KeyUpEvent): void {
    deck.keyUp(ev.action.id);
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

for (const kind of KINDS) streamDeck.actions.registerAction(new LumoraAction(kind));

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

for (const kind of DIAL_KINDS) streamDeck.actions.registerAction(new LumoraDial(kind));

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings & JsonObject>((ev) => deck.setGlobal(ev.settings));

void streamDeck.connect().then(async () => {
  deck.setGlobal(await streamDeck.settings.getGlobalSettings<GlobalSettings & JsonObject>());
});

import sys, json
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('streamdeck/src/actions.ts', [
("""  'slidefirst',
] as const;""", """  'slidefirst',
  'mute',
] as const;"""),
("""  slideshowName?: string;
}""", """  slideshowName?: string;
  /** Mute: "master" (the default), "a", "b", or an input's id, and the input's name. */
  target?: string;
  targetName?: string;
}"""),
("""import type { DeckState, ScreenId } from './show';""", """import type { DeckState, ScreenId } from './show';
import { muteRequest } from './dials';"""),
("""    case 'slidenext':
    case 'slideback':
    case 'slidefirst': {""", """    case 'mute':
      return muteRequest(state, s);
    case 'slidenext':
    case 'slideback':
    case 'slidefirst': {"""),
])

apply('streamdeck/src/dials.ts', [
("""/** Pushing the dial: T-bar: TAKE. Fader: mute or unmute. */""", """/** A Mute key: mute or unmute what it controls. */
export function muteRequest(state: DeckState, s: DialSettings): Request {
  const t = faderTarget(state, s);
  return t ? setMuted(t, !t.level.muted) : { to: 'none', why: 'choose what to mute' };
}

/** Pushing the dial: T-bar: TAKE. Fader: mute or unmute. */"""),
])

apply('streamdeck/src/keys.ts', [
("""import { clock, remaining, tally, type DeckState, type ScreenId } from './show';""", """import { clock, remaining, tally, type DeckState, type ScreenId } from './show';
import { faderTarget } from './dials';"""),
("""    case 'panic': {""", """    case 'mute': {
      const t = state ? faderTarget(state, s) : null;
      if (!t) return { icon: 'mute', label: s.targetName || 'MUTE', sub: state ? 'Choose' : null, tone: 'idle' };
      return { icon: 'mute', label: t.name, sub: t.level.muted ? 'Muted' : `${Math.round(t.level.volume * 100)}%`, tone: t.level.muted ? 'program' : 'idle' };
    }
    case 'panic': {"""),
])

apply('streamdeck/src/icons.ts', [
("""  // A T-bar: a fader track""", """  // A speaker with a slash: mute.
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>',
  // A T-bar: a fader track"""),
])

apply('streamdeck/src/assets.ts', [
("""  macro: 'macro',
};""", """  macro: 'macro',
  mute: 'mute',
};"""),
])

apply('streamdeck/com.lumora.streamdeck.sdPlugin/ui/inspector.js', [
("""FIELDS.tbar = [SCREEN, STEP];
FIELDS.fader = [
  {
    name: 'Controls',""", """const TARGET = {
  name: 'Controls',
  key: 'target',
  remember: 'targetName',
  options: () => [
    ['', 'Stream mix (master)'],
    ['a', 'Mix A (the hall)'],
    ['b', 'Mix B (the recording)'],
    ...lists.inputs.map((i) => [i.id, `${i.number}. ${i.name}`]),
  ],
};
FIELDS.mute = [TARGET];
FIELDS.tbar = [SCREEN, STEP];
FIELDS.fader = [
  {
    name: 'Controls',"""),
("""  tbar: 'Stream Deck +:""", """  mute: 'Mutes and unmutes the Stream mix, mix A or B, or one input. Red while muted; otherwise the key shows the level.',
  tbar: 'Stream Deck +:"""),
])

p = 'streamdeck/com.lumora.streamdeck.sdPlugin/manifest.json'
m = json.load(open(p))
if not any(a['UUID'] == 'com.lumora.streamdeck.mute' for a in m['Actions']):
    i = next(k for k, a in enumerate(m['Actions']) if a['UUID'] == 'com.lumora.streamdeck.tbar')
    m['Actions'].insert(i, {
        "UUID": "com.lumora.streamdeck.mute",
        "Name": "Mute",
        "Tooltip": "Mute or unmute the Stream mix, mix A or B, or one input",
        "Icon": "imgs/actions/mute",
        "PropertyInspectorPath": "ui/inspector.html",
        "Controllers": ["Keypad"],
        "UserTitleEnabled": False,
        "SupportedInMultiActions": True,
        "States": [{"Image": "imgs/keys/mute", "ShowTitle": False}],
    })
open(p, 'w').write(json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('ok')

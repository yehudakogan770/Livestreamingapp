import sys, json
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('streamdeck/src/icons.ts', [
("""  // A warning triangle (Lumora can't be reached).""", """  // A T-bar: a fader track with its handle (a dial on Stream Deck +).
  tbar: '<path d="M12 2.5v19"/><rect x="6.5" y="9" width="11" height="5" rx="1.2"/><path d="M8.5 11.5h7"/>',
  // Three sound faders.
  fader:
    '<path d="M6 3.5v17"/><path d="M12 3.5v17"/><path d="M18 3.5v17"/><rect x="4" y="13" width="4" height="3.2" rx="0.8"/><rect x="10" y="6.5" width="4" height="3.2" rx="0.8"/><rect x="16" y="10" width="4" height="3.2" rx="0.8"/>',
  // A warning triangle (Lumora can't be reached)."""),
])

apply('streamdeck/src/assets.ts', [
("""import { KINDS, type Kind } from './actions';""", """import { KINDS, type Kind } from './actions';
import { DIAL_KINDS } from './dials';"""),
("""  return files;
}""", """  // Stream Deck + dials: their icon in the list, and on the dial.
  for (const kind of DIAL_KINDS) {
    files[`imgs/actions/${kind}.svg`] = iconSvg(kind, 20, '#FFFFFF', 1.6);
    files[`imgs/keys/${kind}.svg`] = iconSvg(kind, 72, '#FFFFFF', 1.4);
  }
  return files;
}"""),
])

p = 'streamdeck/com.lumora.streamdeck.sdPlugin/manifest.json'
m = json.load(open(p))
ids = {a['UUID'] for a in m['Actions']}
new = [
    {
        "UUID": "com.lumora.streamdeck.tbar",
        "Name": "T-bar (dial)",
        "Tooltip": "Stream Deck +: turn to mix Next onto the screen, push for TAKE, touch for CUT",
        "Icon": "imgs/actions/tbar",
        "PropertyInspectorPath": "ui/inspector.html",
        "Controllers": ["Encoder"],
        "Encoder": {
            "layout": "$B1",
            "Icon": "imgs/actions/tbar",
            "TriggerDescription": {"Rotate": "Mix", "Push": "TAKE", "Touch": "CUT"},
        },
        "UserTitleEnabled": False,
        "SupportedInMultiActions": False,
        "States": [{"Image": "imgs/keys/tbar", "ShowTitle": False}],
    },
    {
        "UUID": "com.lumora.streamdeck.fader",
        "Name": "Sound fader (dial)",
        "Tooltip": "Stream Deck +: turn to set the level of the Stream mix, mix A or B, or one input; push or touch to mute",
        "Icon": "imgs/actions/fader",
        "PropertyInspectorPath": "ui/inspector.html",
        "Controllers": ["Encoder"],
        "Encoder": {
            "layout": "$B1",
            "Icon": "imgs/actions/fader",
            "TriggerDescription": {"Rotate": "Level", "Push": "Mute", "Touch": "Mute"},
        },
        "UserTitleEnabled": False,
        "SupportedInMultiActions": False,
        "States": [{"Image": "imgs/keys/fader", "ShowTitle": False}],
    },
]
for a in new:
    if a['UUID'] not in ids:
        m['Actions'].append(a)
m['Description'] = m['Description'].rstrip('.') + ', with the T-bar and sound faders on Stream Deck + dials.'
open(p, 'w').write(json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('ok')

import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('streamdeck/com.lumora.streamdeck.sdPlugin/ui/inspector.js', [
("""FIELDS.slidenext = [SLIDESHOW];""", """const STEP = {
  name: 'One click',
  key: 'step',
  options: [
    ['', 'Usual'],
    ['1', '1%'],
    ['2', '2%'],
    ['5', '5%'],
  ],
};
FIELDS.tbar = [SCREEN, STEP];
FIELDS.fader = [
  {
    name: 'Controls',
    key: 'target',
    remember: 'targetName',
    options: () => [
      ['', 'Stream mix (master)'],
      ['a', 'Mix A (the hall)'],
      ['b', 'Mix B (the recording)'],
      ...lists.inputs.map((i) => [i.id, `${i.number}. ${i.name}`]),
    ],
  },
  STEP,
];
FIELDS.slidenext = [SLIDESHOW];"""),
("""  slidefirst: 'Back to the first slide. The key shows the slide showing (3 / 12).',
};""", """  slidefirst: 'Back to the first slide. The key shows the slide showing (3 / 12).',
  tbar: 'Stream Deck +: turn the dial to mix what is in Next onto the screen (all the way completes the take). Push for TAKE, touch the strip for CUT.',
  fader: 'Stream Deck +: turn the dial to set the level; push it (or touch the strip) to mute and unmute. The strip shows the level.',
};"""),
])

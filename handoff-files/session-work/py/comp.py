import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('companion/src/lumora.js', [
("""  datarow: { name: 'Data row: next / previous', cmd: 'datarow', options: [TO('next, previous or a row number')] },""",
"""  datarow: { name: 'Data row: next / previous', cmd: 'datarow', options: [TO('next, previous or a row number')] },
  play: { name: 'Video: play', cmd: 'play', options: [INPUT] },
  pause: { name: 'Video: pause', cmd: 'pause', options: [INPUT] },
  playpause: { name: 'Video: play / pause', cmd: 'playpause', options: [INPUT] },
  restart: { name: 'Video: from the start', cmd: 'restart', options: [INPUT] },
  playlist: { name: 'Playlist: next / previous / item', cmd: 'playlist', options: [INPUT, { type: 'textinput', id: 'item', label: 'next, previous or an item number', default: 'next' }] },
  lyrics: { name: 'Song lyrics: next / previous', cmd: 'lyrics', options: [INPUT, TO('next, previous, blank or a number')] },
  prompter: {
    name: 'Prompter',
    cmd: 'prompter',
    options: [
      {
        type: 'dropdown',
        id: 'do',
        label: 'Do',
        default: 'toggle',
        choices: [
          { id: 'toggle', label: 'Scroll / stop' },
          { id: 'start', label: 'Scroll' },
          { id: 'stop', label: 'Stop' },
          { id: 'faster', label: 'Faster' },
          { id: 'slower', label: 'Slower' },
          { id: 'top', label: 'Back to the top' },
        ],
      },
    ],
  },
  flash: { name: 'Flash the stage monitor', cmd: 'flash', options: [] },
  score: {
    name: 'Scoreboard: add points',
    cmd: 'score',
    options: [
      INPUT,
      {
        type: 'dropdown',
        id: 'team',
        label: 'Team',
        default: 'home',
        choices: [
          { id: 'home', label: 'Home' },
          { id: 'away', label: 'Away' },
        ],
      },
      { type: 'number', id: 'add', label: 'Points (negative takes away)', default: 1, min: -99, max: 99 },
    ],
  },
  scorereset: { name: 'Scoreboard: back to 0 : 0', cmd: 'scorereset', options: [INPUT] },
  clock: { name: 'Scoreboard: game clock', cmd: 'clock', options: [INPUT, STATE] },
  replaybuffer: { name: 'Instant replay: keep the last minute', cmd: 'replaybuffer', options: [STATE] },
  ptzpreset: {
    name: 'PTZ camera: go to a preset',
    cmd: 'ptz',
    options: [INPUT, { type: 'number', id: 'preset', label: 'Preset', default: 1, min: 1, max: 128 }, { type: 'number', id: 'speed', label: 'Speed (%)', default: 50, min: 1, max: 100 }],
  },
  ptzmove: {
    name: 'PTZ camera: move',
    cmd: 'ptz',
    options: [
      INPUT,
      {
        type: 'dropdown',
        id: 'move',
        label: 'Move',
        default: 'left',
        choices: ['left', 'right', 'up', 'down', 'stop', 'home'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
      },
      { type: 'number', id: 'speed', label: 'Speed (%)', default: 50, min: 1, max: 100 },
    ],
  },
  ptzzoom: {
    name: 'PTZ camera: zoom',
    cmd: 'ptz',
    options: [
      INPUT,
      {
        type: 'dropdown',
        id: 'zoom',
        label: 'Zoom',
        default: 'in',
        choices: [
          { id: 'in', label: 'In' },
          { id: 'out', label: 'Out' },
          { id: 'stop', label: 'Stop' },
        ],
      },
      { type: 'number', id: 'speed', label: 'Speed (%)', default: 50, min: 1, max: 100 },
    ],
  },"""),
("""  p.panic = button('Safety', 'PANIC', 'PANIC', 'panic', { state: 'toggle' }, [{ feedbackId: 'panic', options: {}, style: { bgcolor: RED, color: WHITE } }]);""",
"""  p.panic = button('Safety', 'PANIC', 'PANIC', 'panic', { state: 'toggle' }, [{ feedbackId: 'panic', options: {}, style: { bgcolor: RED, color: WHITE } }]);
  p.nextcue = button('Run of show', 'Next cue', 'NEXT CUE', 'nextcue', {});
  p.flash = button('Stage', 'Flash the stage monitor', 'FLASH', 'flash', {});
  p.prompter = button('Stage', 'Prompter: scroll / stop', 'PROMPT', 'prompter', { do: 'toggle' });
  p.prompter_faster = button('Stage', 'Prompter: faster', 'PROMPT +', 'prompter', { do: 'faster' });
  p.prompter_slower = button('Stage', 'Prompter: slower', 'PROMPT −', 'prompter', { do: 'slower' });
  p.video = button('Video', 'Play / pause input 1', 'PLAY', 'playpause', { input: '1' });"""),
])

apply('companion/src/lumora.test.js', [
("""      'nextcue',
      'panic',
      'atem',
    ]);""", """      'nextcue',
      'panic',
      'atem',
      'play',
      'pause',
      'playpause',
      'restart',
      'playlist',
      'lyrics',
      'prompter',
      'flash',
      'score',
      'scorereset',
      'clock',
      'replaybuffer',
      'ptz',
    ]);"""),
("""    expect(commandFor('nope', {})).toBeNull();""", """    expect(commandFor('nope', {})).toBeNull();
    expect(commandFor('prompter', { do: 'faster' })).toEqual({ cmd: 'prompter', do: 'faster' });
    expect(commandFor('playlist', { input: '2', item: 'next' })).toEqual({ cmd: 'playlist', input: '2', item: 'next' });
    expect(commandFor('score', { input: 'Scoreboard', team: 'away', add: 3 })).toEqual({ cmd: 'score', name: 'Scoreboard', team: 'away', add: '3' });
    expect(commandFor('ptzpreset', { input: '4', preset: 2 })).toEqual({ cmd: 'ptz', input: '4', preset: '2', speed: '50' });
    expect(commandFor('ptzmove', { input: '4', move: 'stop' })).toEqual({ cmd: 'ptz', input: '4', move: 'stop', speed: '50' });
    expect(commandFor('flash', {})).toEqual({ cmd: 'flash' });"""),
])

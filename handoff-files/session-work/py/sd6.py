import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('streamdeck/src/dials.test.ts', [
("""import { Deck } from './deck';""", """import { Deck } from './deck';
import { request } from './actions';
import { keyModel } from './keys';"""),
("""  it('the strip shows the level, Muted, or why not', () => {""", """  it('a Mute key mutes what it controls, and turns red while muted', () => {
    expect(request('mute', { target: 'cam' }, state, 'live')).toEqual({ to: 'action', body: { type: 'updateSource', id: 'cam', patch: { muted: false } } });
    expect(request('mute', {}, state, 'live')).toEqual({ to: 'action', body: { type: 'setMasterMuted', value: true } });
    expect(keyModel('mute', { target: 'cam' }, { state, connection: 'online', deck: 'live', now: 0 })).toMatchObject({ label: 'Camera 1', sub: 'Muted', tone: 'program' });
    expect(keyModel('mute', { target: 'mic' }, { state, connection: 'online', deck: 'live', now: 0 })).toMatchObject({ sub: '50%', tone: 'idle' });
  });

  it('the strip shows the level, Muted, or why not', () => {"""),
])

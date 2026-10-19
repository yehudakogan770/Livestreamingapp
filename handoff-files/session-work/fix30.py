import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='companion/src/lumora.js'
rep(p,"""  datarow: { name: 'Data row: next / previous', cmd: 'datarow', options: [TO('next, previous or a row number')] },""","""  datarow: { name: 'Data row: next / previous', cmd: 'datarow', options: [TO('next, previous or a row number')] },
  // Lumora Titler graphics (take them in and out with Overlay or Input on air).
  titlerfield: {
    name: 'Titler: set a field',
    cmd: 'titler',
    options: [
      { ...INPUT, label: 'Titler graphic (input number or name)' },
      { type: 'textinput', id: 'field', label: 'Field (its {{name}})', default: 'name' },
      { type: 'textinput', id: 'value', label: 'Value', default: '', useVariables: true },
    ],
  },
  titlerdo: {
    name: 'Titler: data row or timer',
    cmd: 'titler',
    options: [
      { ...INPUT, label: 'Titler graphic (input number or name)' },
      {
        type: 'dropdown',
        id: 'do',
        label: 'Do',
        default: 'next',
        choices: [
          { id: 'next', label: 'Next data row' },
          { id: 'previous', label: 'Previous data row' },
          { id: 'toggle', label: 'Timer start / stop' },
          { id: 'start', label: 'Timer start' },
          { id: 'stop', label: 'Timer stop' },
          { id: 'reset', label: 'Timer reset' },
        ],
      },
      { type: 'textinput', id: 'field', label: 'Timer field (empty: the first timer)', default: '' },
    ],
  },""")
rep(p,"""    } else if (o.id === 'minutes' && !['add', 'reset'].includes(String(options.do ?? 'toggle'))) continue;""","""    } else if (o.id === 'minutes' && !['add', 'reset'].includes(String(options.do ?? 'toggle'))) continue;
    else if (o.id === 'field' && actionId === 'titlerdo' && !String(v).trim()) continue;""")
p='companion/src/lumora.test.js'
rep(p,"""      'datarow',
      'nextcue',""","""      'datarow',
      'titler',
      'nextcue',""")
rep(p,"""    expect(commandFor('timer', { do: 'add', minutes: 5 })).toEqual({ cmd: 'timer', do: 'add', minutes: '5' });""","""    expect(commandFor('timer', { do: 'add', minutes: 5 })).toEqual({ cmd: 'timer', do: 'add', minutes: '5' });
    expect(commandFor('titlerfield', { input: 'Lower third', field: 'name', value: 'Ada' })).toEqual({ cmd: 'titler', name: 'Lower third', field: 'name', value: 'Ada' });
    expect(commandFor('titlerdo', { input: '4', do: 'toggle' })).toEqual({ cmd: 'titler', input: '4', do: 'toggle' });
    expect(commandFor('titlerdo', { input: '4', do: 'start', field: 'clock' })).toEqual({ cmd: 'titler', input: '4', do: 'start', field: 'clock' });""")
p='docs/API.md'
rep(p,"""| `ptz`                                   |""","""| `titler`                                | `input` or `name`, then `field` and `value` (or `set.<field>=…`, several at once), or `do` (`next`, `previous`, `start`, `stop`, `toggle`, `reset`) with `field` | A Lumora Titler graphic: its fields, its data rows, its timers |
| `ptz`                                   |""")
rep(p,"""curl "http://127.0.0.1:8095/api/do/macro?name=Start%20show&token=$TOKEN\"""","""curl "http://127.0.0.1:8095/api/do/macro?name=Start%20show&token=$TOKEN"
curl "http://127.0.0.1:8095/api/do/titler?name=Lower%20third&set.name=Ada%20Lovelace&set.role=Host&token=$TOKEN"
curl "http://127.0.0.1:8095/api/do/titler?name=Scoreboard&do=toggle&field=clock&token=$TOKEN\"""")

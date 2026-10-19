import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/ui/controls.tsx')
f.rep("""  options: [T, string][];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map(([v, name]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'is-on' : ''} onClick={() => onChange(v)}>
          {name}
        </button>
      ))}""", """  options: [T, ReactNode, string?][];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map(([v, name, tip]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          aria-label={tip}
          title={tip}
          className={v === value ? 'is-on' : ''}
          onClick={() => onChange(v)}
        >
          {name}
        </button>
      ))}""")
f.save()

f = File('editor/app/src/ui/Inspector.tsx')
f.rep("""            ▴
          </button>""", """            <ChevronUp />
          </button>""", icons=['ChevronUp'])
f.rep("""            ['left', '⇤'],
            ['center', '↔'],
            ['right', '⇥'],""", """            ['left', <AlignLeft key="l" />, 'Left'],
            ['center', <AlignCenter key="c" />, 'Center'],
            ['right', <AlignRight key="r" />, 'Right'],""", icons=['AlignLeft', 'AlignCenter', 'AlignRight'])
f.rep("""                  − frame""", """                  <Minus />
                  Frame""", icons=['Minus'])
f.rep("""                  + frame""", """                  <Plus />
                  Frame""", icons=['Plus'])
f.save()

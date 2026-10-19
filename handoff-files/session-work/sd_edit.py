import json, os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-abe37234ad9ce08a3')

def sub(path, old, new):
    s = open(path).read()
    assert old in s, (path, old[:60])
    s = s.replace(old, new, 1)
    open(path, 'w').write(s)

p = 'streamdeck/src/keys.ts'
sub(p, "import { channelOf, findCountdown, findInput, findPreset, needsHold,", "import { channelOf, findCountdown, findInput, findPreset, findSlideshow, needsHold,")
sub(p, """    case 'backup': {
      const on = !!state?.backup;
      return { icon: 'backup', label: 'BACKUP', sub: state ? (on ? 'Lineup on' : 'Lineup off') : null, tone: on ? 'on' : 'idle' };
    }
  }""", """    case 'backup': {
      const on = !!state?.backup;
      return { icon: 'backup', label: 'BACKUP', sub: state ? (on ? 'Lineup on' : 'Lineup off') : null, tone: on ? 'on' : 'idle' };
    }
    case 'slidenext':
    case 'slideback':
    case 'slidefirst': {
      const icon = kind === 'slidenext' ? 'slideNext' : kind === 'slideback' ? 'slideBack' : 'slideFirst';
      const label = kind === 'slidenext' ? 'NEXT SLIDE' : kind === 'slideback' ? 'BACK' : 'FIRST SLIDE';
      const sh = state ? findSlideshow(state, s, deck) : undefined;
      if (!sh) return { icon, label, sub: state ? 'No slideshow' : null, tone: 'idle' };
      // The slide showing now, like "3 / 12". Red while on air, green while in Next.
      return {
        icon,
        label,
        sub: sh.count ? `${sh.current + 1} / ${sh.count}` : 'No slides',
        tone: sh.onAir ? 'program' : sh.inNext ? 'preview' : 'idle',
      };
    }
  }""")

p = 'streamdeck/src/icons.ts'
sub(p, """  // A warning triangle""", """  // A slide with an arrow onward.
  slideNext: '<rect x="2.5" y="5" width="13" height="10" rx="1"/><path d="M18 10h4"/><path d="m20 8 2 2-2 2"/><path d="M6 19h6"/>',
  // A slide with an arrow back.
  slideBack: '<rect x="8.5" y="5" width="13" height="10" rx="1"/><path d="M6 10H2"/><path d="m4 8-2 2 2 2"/><path d="M12 19h6"/>',
  // Back to the first slide: an arrow to a bar.
  slideFirst: '<rect x="8.5" y="5" width="13" height="10" rx="1"/><path d="M2.5 6v8"/><path d="M7 10H4"/><path d="m5.5 8-2 2 2 2"/><path d="M12 19h6"/>',
  // A warning triangle""")

p = 'streamdeck/src/assets.ts'
sub(p, """  backup: 'backup',
};""", """  backup: 'backup',
  slidenext: 'slideNext',
  slideback: 'slideBack',
  slidefirst: 'slideFirst',
};""")

p = 'streamdeck/src/deck.ts'
sub(p, """  countdowns: { id: string; name: string }[];
}""", """  countdowns: { id: string; name: string }[];
  slideshows: { id: string; name: string }[];
}""")
sub(p, """      countdowns: s?.countdowns.map(({ id, name }) => ({ id, name })) ?? [],
    };""", """      countdowns: s?.countdowns.map(({ id, name }) => ({ id, name })) ?? [],
      slideshows: s?.slideshows.map(({ id, name }) => ({ id, name })) ?? [],
    };""")

p = 'streamdeck/com.lumora.streamdeck.sdPlugin/ui/inspector.js'
sub(p, "let lists = { connection: 'off', inputs: [], presets: [], overlays: [], countdowns: [] };",
    "let lists = { connection: 'off', inputs: [], presets: [], overlays: [], countdowns: [], slideshows: [] };")
sub(p, """const HINTS = {""", """const SLIDESHOW = {
  name: 'Slideshow',
  key: 'slideshow',
  remember: 'slideshowName',
  options: () => pick(lists.slideshows || [], (s) => s.name, 'The one on air'),
};
FIELDS.slidenext = [SLIDESHOW];
FIELDS.slideback = [SLIDESHOW];
FIELDS.slidefirst = [SLIDESHOW];

const HINTS = {""")
sub(p, """  backup: 'Turns the backup lineup on or off: if the camera on air goes out, the next one goes on air by itself. Lit while it is on.',
};""", """  backup: 'Turns the backup lineup on or off: if the camera on air goes out, the next one goes on air by itself. Lit while it is on.',
  slidenext: 'The next slide. The key shows the slide showing (3 / 12). Red: the slideshow is on air. Green: in Next.',
  slideback: 'The slide before. The key shows the slide showing (3 / 12).',
  slidefirst: 'Back to the first slide. The key shows the slide showing (3 / 12).',
};""")

p = 'streamdeck/com.lumora.streamdeck.sdPlugin/manifest.json'
m = json.load(open(p))
names = {
    'slidenext': ('Next slide', 'The slideshow’s next slide (the key shows the slide number)'),
    'slideback': ('Previous slide', 'The slideshow’s slide before (the key shows the slide number)'),
    'slidefirst': ('First slide', 'Back to the slideshow’s first slide'),
}
for k, (n, t) in names.items():
    m['Actions'].append({
        "UUID": f"com.lumora.streamdeck.{k}", "Name": n, "Tooltip": t,
        "Icon": f"imgs/actions/{k}", "PropertyInspectorPath": "ui/inspector.html",
        "Controllers": ["Keypad"], "UserTitleEnabled": False, "SupportedInMultiActions": True,
        "States": [{"Image": f"imgs/keys/{k}", "ShowTitle": False}],
    })
open(p, 'w').write(json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('ok')

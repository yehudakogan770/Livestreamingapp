import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/ui/Deliver.tsx')
f.rep("""              <span className="dlv__gname">{GROUP_NAMES[g]}</span>""", """              <span className="dlv__gname">
                {(() => {
                  const Icon = GROUP_ICONS[g];
                  return <Icon />;
                })()}
                {GROUP_NAMES[g]}
              </span>""")
f.rep("""          {settings ? '▾' : '▸'} Settings: {describe(p, s)}""", """          {settings ? <ChevronDown /> : <ChevronRight />}
          <Settings2 />
          Settings: {describe(p, s)}""", icons=['ChevronDown', 'ChevronRight', 'Settings2'])
f.rep("""              Save preset…
            </button>""", """              <BookmarkPlus />
              Save preset…
            </button>""", icons=['BookmarkPlus'])
f.rep("""            Add to queue
          </button>""", """            <ListPlus />
            Add to queue
          </button>""", icons=['ListPlus'])
f.rep("""            onClick={() => void queue(true)}
          >
            Export
          </button>""", """            onClick={() => void queue(true)}
          >
            <Upload />
            Export
          </button>""", icons=['Upload'])
f.rep("""} from '../export/presets';
""", """} from '../export/presets';
import type { LucideIcon } from 'lucide-react';

const GROUP_ICONS: Record<PresetGroup, LucideIcon> = {
  web: Globe,
  social: Smartphone,
  broadcast: Tv,
  master: HardDrive,
  audio: AudioLines,
  image: Image,
  custom: Bookmark,
};
""", icons=['Globe', 'Smartphone', 'Tv', 'HardDrive', 'AudioLines', 'Image', 'Bookmark'])
f.save()

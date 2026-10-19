import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File, glyph_lines

for rel in ['ui/Inspector.tsx', 'ui/Monitors.tsx', 'ui/ColorPage.tsx', 'ui/ProMotion.tsx', 'ui/Editor.tsx', 'ui/Templates.tsx', 'ui/ProjectPanel.tsx', 'ui/ShortcutEditor.tsx', 'ui/Manage.tsx', 'ui/Dialogs.tsx', 'ui/Tracking.tsx', 'ui/Deliver.tsx', 'ui/Start.tsx', 'smart/SmartTools.tsx']:
    f = File('editor/app/src/' + rel)
    glyph_lines(f)
    f.save()
    print(rel, f.icons)

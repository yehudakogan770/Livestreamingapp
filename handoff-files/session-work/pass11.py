import re
import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

for rel, label, icon in [
    ('ui/Inspector.tsx', 'Color correction', 'Plus'),
    ('ui/ColorPage.tsx', 'Vignette', 'Plus'),
    ('ui/ProMotion.tsx', 'Add animator', 'Plus'),
    ('ui/Manage.tsx', 'Add a rule', 'Plus'),
    ('ui/Tracking.tsx', 'Track a point', 'Crosshair'),
    ('ui/Tracking.tsx', 'Track a region', 'Scan'),
]:
    f = File('editor/app/src/' + rel)
    f.sub(r"^(\s*)\+ " + re.escape(label) + r"$", lambda m: f"{m.group(1)}<{icon} />\n{m.group(1)}{label}", icons=[icon])
    f.save()

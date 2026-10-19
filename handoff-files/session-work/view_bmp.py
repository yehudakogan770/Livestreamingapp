import sys
from PIL import Image
root = '/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0/'
out = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/'
names = sys.argv[1:]
row = []
for n in names:
    im = Image.open(root + n).convert('RGB')
    row.append(im)
W = sum(i.width for i in row) + 20 * len(row)
H = max(i.height for i in row)
sheet = Image.new('RGB', (W, H), (255, 0, 255))
x = 0
for im in row:
    sheet.paste(im, (x, 0))
    x += im.width + 20
sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
sheet.save(out + 'bmp-sheet.png')
print('ok')

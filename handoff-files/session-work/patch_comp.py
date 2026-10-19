import sys
p = sys.argv[1]
s = open(p).read()
start = s.index('  /** A poll (mirrors PollView and its CSS; sizes are % of the frame height). */')
end = s.index('  /** The dark background, title (and subtitle) that raffles and fundraisers share')
new = open(sys.argv[2]).read()
s = s[:start] + new + '\n' + s[end:]
s = s.replace("import { shares } from '../engine/poll';",
              "import { averageText, countText, ratingAverage, shares } from '../engine/poll';\n"
              "import { CLOUD_COLORS, CloudCache, cloudFont, starFill, starPoints } from '../engine/wordCloud';\n"
              "import { JOIN_LABEL } from '../components/PollView';")
s = s.replace("  private readonly media = new Map<string, Media>();",
              "  private readonly media = new Map<string, Media>();\n  /** Word clouds' layouts (worked out once for each set of words). */\n  private readonly clouds = new CloudCache();", 1)
open(p, 'w').write(s)
print('ok')

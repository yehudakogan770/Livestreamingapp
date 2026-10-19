p='export/audioplan.ts'
s=open(p).read()
a=s.index("/**\n * The FFmpeg graph that makes the sound of [from, to).")
s=s[:a]+open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/graph.ts').read()
open(p,'w').write(s)

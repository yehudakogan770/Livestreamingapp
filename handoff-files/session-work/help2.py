p='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/editor/app/src/ui/guide.ts'
s=open(p).read()
a=s.index("  {\n    id: 'titler',")
b=s.index("  {\n    id: 'interchange',")
block=s[a:b]
s=s[:a]+s[b:]
end=s.index('];\n\n/** Topics whose title')
s=s[:end]+block+s[end:]
open(p,'w').write(s)

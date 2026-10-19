import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/designer/Viewport.tsx'
rep(p,"""  // Draw on every change, and every frame while playing or previewing a take.
  useEffect(() => {""","""  // A timer field running (the control panel's Start): the canvas follows it.
  const ticking = useStore(store, (s) => s.project.variables.some((v) => v.type === 'timer' && timerRunning(s.values[v.key] ?? v.value)));
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => requestAnimationFrame(draw), 100);
    return () => clearInterval(id);
  }, [ticking, draw]);

  // Draw on every change, and every frame while playing or previewing a take.
  useEffect(() => {""")
s=open(p).read()
s=s.replace("\nimport ","\nimport { timerRunning } from '../core/timer';\nimport ",1)
open(p,'w').write(s)

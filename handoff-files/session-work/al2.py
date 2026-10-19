import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

p = 'app/src/engine/chatThanks.ts'
rep(p, """  const queue = useRef(new ThanksQueue());
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    if (!card) return;
    const tick = () => {
      const r = queue.current.step(chat.state.messages, Date.now(), thanksOn());
      if (r) actRef.current(r.show ? { type: 'showComment', id: card, comment: r.show } : { type: 'showComment', id: card });
    };""", """  const queue = useRef(new ThanksQueue());
  const actRef = useRef(act);
  actRef.current = act;
  const showRef = useRef(show);
  showRef.current = show;
  const last = useRef<ChatComment | null>(null);
  useEffect(() => {
    if (!card) return;
    const tick = () => {
      const r = queue.current.step(chat.state.messages, Date.now(), thanksOn());
      if (!r) return;
      if (r.show) {
        last.current = r.show;
        actRef.current({ type: 'showComment', id: card, comment: r.show });
        return;
      }
      // Taken off only if the card still shows the thank-you (not a comment chosen since).
      const k = showRef.current.sources.find((s) => s.id === card)?.kind;
      const now = k?.type === 'comment' ? k.comment : null;
      if (now && last.current && now.author === last.current.author && now.text === last.current.text) actRef.current({ type: 'showComment', id: card });
      last.current = null;
    };""")

p = 'app/src/views/ControlView.tsx'
s = open(p).read()
i = s.index('\nimport ')
s = s[:i] + "\nimport { useChatThanks } from '../engine/chatThanks';" + s[i:]
open(p, 'w').write(s)
s = open(p).read()
# After the act callback is defined.
idx = s.index('  const act: Act = useCallback(')
end = s.index(');\n', idx) + 3
s = s[:end] + "  // Thank-yous for viewers' support, on the chat comments card (when turned on).\n  useChatThanks(show, act);\n" + s[end:]
open(p, 'w').write(s)

p = 'app/src/views/ChatPanel.tsx'
rep(p, """                  <div className="chat__who" style={{ color: m.color }} dir="auto">
                    {m.author} <small>{PLATFORM_SHORT[m.platform]}</small>
                  </div>""", """                  <div className="chat__who" style={{ color: m.color }} dir="auto">
                    {m.author} <small>{PLATFORM_SHORT[m.platform]}</small>
                    {m.badge && <span className="chat__badge">{m.badge}</span>}
                  </div>""")
rep(p, """  const showIt = (m: ChatMessage) => {
    if (!card) return;
    act({ type: 'showComment', id: card.id, comment: { author: m.author, text: m.text, platform: m.platform } });
  };""", """  const showIt = (m: ChatMessage) => {
    if (!card) return;
    act({ type: 'showComment', id: card.id, comment: { author: m.author, text: m.badge ? thanksText(m) : m.text, platform: m.platform } });
  };
  const thanks = useThanksOn();""")
rep(p, """import { chat, useChat, type ChatMessage } from '../engine/chat';""", """import { chat, thanksText, useChat, type ChatMessage } from '../engine/chat';
import { setThanksOn, useThanksOn } from '../engine/chatThanks';""")
rep(p, """          <input className="text chat__find" placeholder="Find…\"""", """          <label className="check chat__thanks" title="Super Chats, new members and subscribers, bits and raids show on the card for 8 seconds, one after another">
            <input type="checkbox" checked={thanks} onChange={(e) => setThanksOn(e.target.checked)} /> Thank supporters on screen by themselves
          </label>
          <input className="text chat__find" placeholder="Find…\"""")

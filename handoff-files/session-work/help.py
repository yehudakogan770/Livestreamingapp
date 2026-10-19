root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/'
def rep(path,a,b):
    s=open(root+path).read()
    assert s.count(a)==1,(path,a[:70],s.count(a))
    s=s.replace(a,b)
    open(root+path,'w').write(s)

rep('app/src/help/manual.ts',"""  {
    id: 'countdown',
    title: 'Countdown timer',""","""  {
    id: 'titler',
    title: 'Lumora Titler: animated lower thirds, bugs, tickers and scoreboards',
    keywords: 'titler motion graphics lower third name role bug ticker crawl scoreboard card template animation keyframe fields lumtitle design',
    body: [
      'Lumora Titler designs graphics that animate in and out: lower thirds, logo and live bugs, tickers, scoreboards, countdown, quote and sponsor cards. They take the event look (Event → Event look) by themselves.',
      '1. Text → Add a Titler graphic… (or Overlays → Add a Titler graphic…): choose a template, then Add input.',
      '2. On its tile, ⋯ → Fields, take in and out…: type the name, role, scores and other fields. Changes show at once, even on air.',
      '3. Take IN plays its animation in over the screen you control and it holds; Take OUT plays its animation out, then it is gone. The overlay buttons under On air do the same.',
      '• Scores, the game clock, the countdown, the time of day and data file columns fill fields by themselves when the template asks for them.',
      '• Text → Titler… (or Edit in Titler… on its card) opens the designer in its own window: layers, keyframes, the timeline with its IN, HOLD and OUT markers, fields and the look. Use in … puts the design back into the graphic; Add to Lumora makes a new one.',
      '• Titles saved in the designer go to Documents/Lumora/Titles, shared with Lumora Studio and the Lumora Titler app. A .lumtitle file carries its pictures and fonts.',
      'Tip: The same graphic looks the same on the screens, in the recording and in the stream: it is drawn by the same renderer everywhere.',
    ],
  },
  {
    id: 'countdown',
    title: 'Countdown timer',""")

rep('editor/app/src/ui/guide.ts',"""export const GUIDE: GuideTopic[] = [
""","""export const GUIDE: GuideTopic[] = [
  {
    id: 'titler',
    title: 'Titler graphics (Lumora Titler)',
    where: 'Text & more > Titler graphics, and the Inspector for a title clip',
    paragraphs: [
      'Titler graphics are animated titles made in Lumora Titler: lower thirds, bugs, tickers, scoreboards and cards. Click a template (or one of your titles from Documents/Lumora/Titles) and it is added at the playhead, above the pictures, as long as the title was designed.',
      'A title clip plays its IN from the clip’s start, holds, and plays its OUT so that it ends with the clip. Trim the clip to make it stay longer or shorter; the marks on the clip show where the IN ends and the OUT starts, and its keyframes.',
      'Select the clip to fill in its fields in the Inspector (name, role, scores…). Edit in Titler… opens the designer over Studio with every layer, keyframe and easing curve; Use in this clip puts the new design back.',
      'Title clips are drawn by the same renderer as Lumora uses on air, so a title looks the same live and in the edit, and in every export.',
    ],
  },
""")

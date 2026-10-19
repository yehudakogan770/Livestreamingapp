import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aba3a6fa63da8b178')
p='app/src/views/AddInput.tsx'
s=open(p).read()
rep=[
("import { CapturePicker } from './CapturePicker';","import { CapturePicker } from './CapturePicker';\nimport { DeckLinkPicker } from './DeckLinkPicker';"),
("type Kind = SourceKind['type'] | 'sound';","type Kind = SourceKind['type'] | 'sound' | 'decklink';"),
("/** What can be added; a sound file is stored as a video source that is never shown. */","/** What can be added; a sound file is stored as a video source that is never shown, a capture card as a stream input. */"),
("  { kind: 'camera', name: 'Camera', hint: 'Webcam, capture card or phone' },\n","  { kind: 'camera', name: 'Camera', hint: 'Webcam, capture card or phone' },\n  { kind: 'decklink', name: 'Blackmagic capture card', hint: 'DeckLink, UltraStudio or Intensity: SDI or HDMI, with its sound' },\n"),
("  { name: 'Cameras and people', kinds: ['camera', 'stream', 'guest', 'screen'] },","  { name: 'Cameras and people', kinds: ['camera', 'decklink', 'stream', 'guest', 'screen'] },"),
("  const [screenCap, setScreenCap] = useState<ScreenCapture | null>(null);\n","  const [screenCap, setScreenCap] = useState<ScreenCapture | null>(null);\n  const [card, setCard] = useState<string | null>(null);\n"),
("""      case 'stream': {
        const url = cleanStreamUrl(words);""","""      case 'decklink':
        // No buffer: a capture card is right here.
        return card ? { name: n || streamName(card), kind: { type: 'stream', url: card, bufferMs: 0 } } : null;
      case 'stream': {
        const url = cleanStreamUrl(words);"""),
("            {kind === 'screen' && <CapturePicker client={client} value={screenCap} onChange={setScreenCap} />}","            {kind === 'screen' && <CapturePicker client={client} value={screenCap} onChange={setScreenCap} />}\n            {kind === 'decklink' && <DeckLinkPicker onChange={setCard} />}"),
]
for a,b in rep:
    assert a in s, a[:60]
    s=s.replace(a,b,1)
open(p,'w').write(s)

p='app/src/views/kindIcons.ts'
s=open(p).read()
s=s.replace("  BookOpen,\n","  BookOpen,\n  Cable,\n",1)
s=s.replace("  camera: Camera,\n","  camera: Camera,\n  decklink: Cable,\n",1)
open(p,'w').write(s)

p='app/src/views/StreamCard.tsx'
s=open(p).read()
a="""import { cleanStreamUrl } from '../engine/stream';"""
assert a in s
s=s.replace(a,a+"""\nimport { isCardUrl } from '../engine/decklink';\nimport { CardSignalLine } from './DeckLinkPicker';""",1)
a="""            {(problem ?? status?.problem) && ("""
assert a in s
s=s.replace(a,"""            {isCardUrl(st.url) && <CardSignalLine url={st.url} />}
"""+a,1)
open(p,'w').write(s)

p='app/src/engine/stream.ts'
s=open(p).read()
a="return input ? `${name} ${input.toUpperCase()}` : name || 'Capture card';"
assert a in s
s=s.replace(a,"return input ? `${name ?? ''} ${input.toUpperCase()}` : name || 'Capture card';")
open(p,'w').write(s)

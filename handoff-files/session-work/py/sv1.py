import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/ShowView.tsx'
apply(P, [
("""  const mode = live?.mode === 'rehearsal' ? 'Rehearsal' : 'Show';""",
"""  // The list follows the show: the cue on now stays in view.
  const nowId = cur?.id;
  useEffect(() => {
    if (nowId) document.getElementById(`show-row-${nowId}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [nowId]);

  const mode = live?.mode === 'rehearsal' ? 'Rehearsal' : 'Show';"""),
("""                <li
                  key={c.id}
                  className={`show__row""",
"""                <li
                  key={c.id}
                  id={`show-row-${c.id}`}
                  className={`show__row"""),
("""  const [chrome, setChrome] = useState(true);""",
"""  const [chrome, setChrome] = useState(true);
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem('lumora.planner.timer.sound') === '1';
    } catch {
      return false;
    }
  });
  // A soft chime at "wrap up", and two when the time is up (if sound is on).
  const lastTone = useRef(tone);
  useEffect(() => {
    const was = lastTone.current;
    lastTone.current = tone;
    if (!sound || was === tone || !cur) return;
    if (tone === 'wrap' && was === 'ok') chime(1);
    else if (tone === 'over') chime(2);
  }, [tone, sound, cur]);"""),
("""        <span className="bar__spacer" />
        <button type="button" className="stage__btn" onClick={full}>""",
"""        <span className="bar__spacer" />
        <button
          type="button"
          className={`stage__btn${sound ? ' is-on' : ''}`}
          aria-pressed={sound}
          onClick={() => {
            const next = !sound;
            setSound(next);
            if (next) chime(1);
            try {
              localStorage.setItem('lumora.planner.timer.sound', next ? '1' : '0');
            } catch {
              // Not remembered: fine.
            }
          }}
        >
          {sound ? <Volume2 size={16} strokeWidth={1.75} aria-hidden="true" /> : <VolumeX size={16} strokeWidth={1.75} aria-hidden="true" />}
          Chime
        </button>
        <button type="button" className="stage__btn" onClick={full}>"""),
("""import { ArrowLeft, ChevronLeft, ChevronRight, Expand, Pause, Play, ScrollText, Square, Timer, X } from 'lucide-react';""",
"""import { ArrowLeft, ChevronLeft, ChevronRight, Expand, Pause, Play, ScrollText, Square, Timer, Volume2, VolumeX, X } from 'lucide-react';"""),
("""/** A small "Now / Next" strip for crew phones and the plan's footer. */""",
"""let audio: AudioContext | null = null;
/** A short, soft chime (`n` of them), for the stage timer. */
function chime(n: number): void {
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    for (let i = 0; i < n; i++) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.3);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.35);
      o.stop(t0 + i * 0.35 + 0.32);
    }
  } catch {
    // No sound here: the colors still say it.
  }
}

/** A small "Now / Next" strip for crew phones and the plan's footer. */"""),
])

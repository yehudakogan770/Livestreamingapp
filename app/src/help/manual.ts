// The how-to manual (Help → How to use Lumora): plain words, step by step,
// kept offline in the app. Each topic: a title, words people might search
// for, and its paragraphs. A paragraph starting "1. " is a step; "• " a point;
// "Tip: " a tip.

export interface Topic {
  id: string;
  title: string;
  /** Other words people might look for. */
  keywords: string;
  body: string[];
  /** Part of the Jewish event tools (shown only when they are on). */
  jewish?: boolean;
}

export const MANUAL: Topic[] = [
  {
    id: 'start',
    title: 'Start here: the main screen',
    keywords: 'overview begin first time layout next on air',
    body: [
      '• Settings → Arrange the screen…: drag a part (Next, On air, the TAKE buttons, the inputs, the mixer) onto another to swap them, drag the dividers to resize, and put Presets left, right or away. Lumora remembers it.',
      'Lumora runs up to three screens at once: the Live Screen (the stream and recording), the Back Screen (the projector behind the stage) and the Monitor (text for the people on stage). The tabs at the top choose which one you are controlling (or press F1, F2, F3).',
      '• Next (left, green) is what you are getting ready. Nobody sees it yet.',
      '• On air (right, red) is what everyone sees now.',
      '• In the middle: TAKE and CUT send Next to On air, with the fader and the transitions under them.',
      '• Under the monitors: your inputs (every camera, video, picture and title), the audio mixer, and the controls for whatever is in Next or on air.',
      '• The bottom bar: All good (the health check), Outputs, Back = Live, REC, GO LIVE, REPLAY, and on the right Blank and PANIC.',
      'Tip: The first time, Event → Event setup… walks you through the event name, logo and screens.',
    ],
  },
  {
    id: 'setup',
    title: 'Before the event: setup and saving',
    keywords: 'event setup save open file new logo name backup',
    body: [
      '1. Event → Event setup…: the event’s name and logo, and what the screens show if something breaks.',
      '2. Outputs (bottom bar): choose which screen or projector shows the Live Screen, the Back Screen and the Monitor.',
      '3. Speakers… (in the audio mixer): where the sound goes — the stream, the hall speakers, the recording, headphones.',
      '4. Event → Save event as…: keep everything (inputs, titles, looks, cameras’ settings) in one file. Event → Open event… brings it back next time.',
      'Tip: Lumora keeps working without the internet. Only streaming and the audience internet link need it.',
    ],
  },
  {
    id: 'inputs',
    title: 'Adding inputs (cameras, videos, pictures…)',
    keywords: 'add input camera video picture color webcam capture card phone ip camera screen capture web page music microphone',
    body: [
      '1. Click + Add input (under the monitors) or Inputs → Add input….',
      '2. Choose what it is: Camera, Video file, Picture, Color, Countdown, Text / title, Slideshow, Song lyrics, Microphone, Sound / music file, Web page, Screen capture, Stream / IP camera, Guest by link, and the audience features (poll, raffle, fundraiser, messages wall, auction, trivia, table finder).',
      '3. Give it a name and click Add input. It is lined up in Next.',
      'Each input’s ⋯ menu has its settings: crop, colors, green screen, delay, playlist, and remove.',
      'Tip: Keys 1 – 9 and 0 line up input 1 – 10 in Next.',
    ],
  },
  {
    id: 'switching',
    title: 'Going on air: TAKE, CUT and the fader',
    keywords: 'take cut transition fade wipe fader t-bar switch preview program',
    body: [
      '1. Click an input to line it up in Next.',
      '2. Press TAKE (or Enter) to send it on air with the chosen transition (Fade, Dip, Wipe, Slide… and how long).',
      '3. CUT (Shift + Enter) switches straight away, with no transition.',
      '4. The fader: drag it from the left to mix by hand. Once the mix is complete it springs back to the left, ready for the next one.',
      '• Fade to black fades the screen out (and back).',
      '• Back = Live makes the Back Screen follow the Live Screen.',
      'Tip: Ctrl + 1 – 4 takes with your favorite transitions.',
    ],
  },
  {
    id: 'cameras',
    title: 'Cameras: switching, Auto and camera control',
    keywords: 'camera switch auto director zoom focus exposure white balance pan tilt ptz shot preset tally',
    body: [
      'Under the Next monitor there is a button for each camera. Click one to put it straight on air. Right-click to line it up in Next instead. Red = on air, green = in Next.',
      'Auto goes through the cameras by itself:',
      '1. Click ⚙ → Switching.',
      '2. Tick the cameras to use, how long each shot lasts (for example 6 to 10 seconds), In order or Mixed up, and Cut or Quick mix.',
      '3. Click Start switching by itself (or the Auto button under Next).',
      'It only switches while one of those cameras is on the Live Screen. Put a video or title on and it waits, then carries on. Overlays (like a logo or a title) stay on top.',
      'Camera control (⚙ → a camera’s tab): zoom, pan and tilt, focus, light and color — whatever that camera lets the computer change. Save shots (like “Speaker close-up”) and click one to go back to it. It is all kept with the event.',
      'Network cameras that move (PTZ) are set up in the input’s ⋯ menu, with their preset buttons.',
      'Tip: Cameras plugged into the computer must be seen by Windows. When running Lumora inside WSL, use the Windows installer instead for cameras.',
    ],
  },
  {
    id: 'pesukim',
    title: '12 Pesukim',
    jewish: true,
    keywords: 'pesukim pasuk kids children word hebrew transliteration english translation bar',
    body: [
      'The 12 Pesukim are built in: the Hebrew, how each word sounds, what each word means, and a translation of each whole pasuk.',
      '1. Inputs → Add the 12 Pesukim bar (ready in Next). The bar goes over the Live Screen; the cameras keep switching underneath.',
      '2. Click Edit… on the controls to type each child’s name (their name comes up just before their pasuk).',
      '3. Bar on shows it. Then Space (or →, Page Down, or a presenter clicker) goes to the next word; ← goes back.',
      '• Whole (P): the whole pasuk, with how it sounds and its translation.',
      '• Hide (B): hides the words (the camera stays).',
      '• Text only: no bar, just the words in the same place, in two colors so they are easy to read on anything.',
      '• The row of words: click any word to jump to it. The picker at the top jumps to any pasuk.',
      'In Edit…: how the bar comes on and how each word comes on (fade, rise, pop, zoom, focus, typewriter…), one word at a time or the whole line with the word lit, the bar design (or your own picture), the colors, which lines show, and next word by itself every few seconds.',
    ],
  },
  {
    id: 'titles',
    title: 'Titles and the event look',
    keywords: 'title lower third name text ticker font color brand branding look design',
    body: [
      '1. Text → Add a lower third… (or a title, ticker or full-screen message). Type the words; it goes into Next.',
      '2. Put it on as an overlay (see Overlays) so it sits over the camera.',
      'Event → Event look (branding)… sets the look of every title at once:',
      '• Ready-made: click a look, then change anything.',
      '• Words: font, size, thickness, italic, CAPITALS, colors, outline, shadow, spacing, and the second line’s own color, size and font.',
      '• Box: design, color, see-through, accent color, corners, room, border.',
      '• Place & motion: where name titles go, and how they come on — 14 effects: build, fade, slide, rise, drop, pop, zoom, flip, focus, wipe, typewriter, bounce, spin and shine.',
      '• Fonts: 500 fonts are built in (58 with Hebrew), shown in groups with a search. Add your own font files too, or type the name of any font on the computer.',
      'Apply to everything changes every title now, and new titles come in that look.',
    ],
  },
  {
    id: 'overlays',
    title: 'Overlays: logos and titles over the picture',
    keywords: 'overlay logo bug picture in picture lower third on top',
    body: [
      'An overlay sits on top of what is on air: a logo in the corner, a name title, picture-in-picture.',
      '1. Overlays → Set up overlays… and choose an input for channel 1 – 4, where it goes, and how it comes in and out.',
      '2. Click its number (next to OVERLAYS under On air), or press Shift + 1 – 4, to put it on or take it off.',
      'Tip: Overlays → Take every overlay off clears them all at once.',
    ],
  },
  {
    id: 'countdown',
    title: 'Countdown timer',
    keywords: 'countdown timer starting soon clock minutes',
    body: [
      '1. Timer → Add a countdown… : how long, the words, the look, and what happens at zero.',
      '2. Put it in Next: its controls come up (Start, pause, add a minute). Take it on air.',
      '• To go to a time: click the time and type it (3:00, 1:15:00, or just 5 for five minutes), then Enter.',
      '• At zero it goes to what is in Next, so line up the next thing (the opening video, a camera). Timer settings can change this: stay on 0, show words, the logo, or black.',
      'Tip: The stage Monitor can show the time left to the people on stage.',
    ],
  },
  {
    id: 'slides',
    title: 'Slideshows, songs and credits',
    keywords: 'slideshow powerpoint pdf slides song lyrics credits',
    body: [
      '• Slideshow: pictures or a PDF (save PowerPoint as PDF first). Space or a clicker moves on.',
      '• Song lyrics: paste the words; each part comes up in turn.',
      '• Credits / thank-you: names rolling at the end.',
      'Each one’s controls come up as soon as it is in Next, and stay while it is on air.',
    ],
  },
  {
    id: 'sound',
    title: 'Sound and the audio mixer',
    keywords: 'audio sound mixer volume microphone music mute speakers headphones ducking',
    body: [
      'Every input with sound has a fader and a meter in the audio mixer. M mutes it.',
      '• The Stream, Hall and Recording mixes each have their own level (Speakers… chooses where each is heard).',
      '• A channel’s settings: low cut, EQ, noise gate, compressor, noise removal, delay.',
      '• “Quieter while someone talks”: music gets quieter while a microphone plugged into this computer is used.',
      'Tip: When the hall’s own mixing desk runs the microphones, bring its output into the computer as one Microphone input.',
    ],
  },
  {
    id: 'stream',
    title: 'Streaming and recording',
    keywords: 'stream live youtube facebook rtmp record recording replay highlight',
    body: [
      '1. Settings → Recording and streaming…: where to stream (YouTube, Facebook, or any RTMP address) and where recordings go.',
      '2. GO LIVE starts the stream; REC starts recording. Both show red while running.',
      '• REPLAY: play back the last seconds, in slow motion if you like; “★ Keep as a highlight” saves it for the highlights reel.',
    ],
  },
  {
    id: 'audience',
    title: 'The audience’s phones',
    keywords: 'audience phone vote poll question raffle pledge donation message wall auction trivia seating table qr wifi internet link',
    body: [
      'Guests scan the code on the screen with their phone — no app needed. They can vote in polls, ask questions, enter raffles, pledge, send messages and photos to the wall, bid in the auction, play trivia and find their table.',
      'How phones reach Lumora (in each feature’s setup):',
      '• Same Wi-Fi: phones on the hall’s Wi-Fi.',
      '• Anyone with internet: a free internet link, so phones on mobile data work too.',
      '• Wi-Fi code: a second code on screen to join the hall’s Wi-Fi.',
      'You approve what shows on screen (messages, questions) unless you choose to let them through by themselves.',
    ],
  },
  {
    id: 'monitor',
    title: 'Stage monitor and teleprompter',
    keywords: 'monitor stage confidence teleprompter prompter message speaker notes',
    body: [
      'The Monitor is for the people on stage. There are no controls on it: everything is sent from here (F3).',
      '• Send messages (“2 minutes left”, “Speak louder”), the time, the countdown and what is coming next.',
      '• Teleprompter: paste the script, then start, pause and change the speed; mirror it for glass prompters.',
    ],
  },
  {
    id: 'remote',
    title: 'Remote control: phone, Stream Deck, clicker, MIDI',
    keywords: 'remote phone stream deck companion clicker presenter midi controller keyboard',
    body: [
      '• Settings → Phone remote…: control Lumora from a phone (with a PIN).',
      '• Stream Deck / Companion: buttons for takes, overlays, slides, the teleprompter and more.',
      '• Presenter clickers move the slides (and the words of anything shown a part at a time).',
      '• Settings → MIDI controller…: faders and buttons on a MIDI desk.',
      'Help → Keyboard shortcuts lists every key.',
    ],
  },
  {
    id: 'presets',
    title: 'Presets, cues and the run of show',
    keywords: 'preset cue run of show order program schedule trigger automatic',
    body: [
      '• Presets: one button that sets several things at once (the camera, titles, sound). Presets → Add a preset….',
      '• Cues → Run of show…: the order of the evening; N goes to the next cue.',
      '• Cues → Triggers: when something happens (a countdown ends, a time comes), do something by itself.',
    ],
  },
  {
    id: 'zmanim',
    title: 'Tanach, Hebrew date, zmanim and Shabbos',
    jewish: true,
    keywords: 'zmanim shabbos shabbat candle lighting hebrew date yom tov stop tanach tehillim',
    body: [
      '• Tanach & Tehillim (an input): any passage, a verse at a time or whole, in Hebrew and English; today’s Tehillim.',
      'Event → Zmanim and Shabbos…: the city of the event. Lumora works out the day’s zmanim offline.',
      '• Show the zmanim or the Hebrew date on screen (Hebrew date & zmanim input).',
      '• The stage Monitor is warned before candle lighting.',
      '• It can end the stream and the recording by itself before Shabbos and Yom Tov.',
    ],
  },
  {
    id: 'safety',
    title: 'When something goes wrong',
    keywords: 'problem error panic blank black help broken frozen cpu all good',
    body: [
      '• PANIC (double-click): the audience sees nothing (black). One click brings it back. Your on-air picture shows a small “PANIC on” tag.',
      '• If a camera or video stops working, the screen shows the logo (the event’s, or Lumora’s until you choose one) instead of freezing.',
      '• Blank Live / Back / Monitor: that screen goes black (B for the one you control).',
      '• All good (bottom left) turns yellow or red when something needs attention; click it to see what.',
      '• CPU and graphics use are shown at the bottom; if they are high, close other programs.',
    ],
  },
  {
    id: 'keys',
    title: 'Keyboard shortcuts',
    keywords: 'keys shortcuts keyboard hotkeys',
    body: [
      '• 1 – 9, 0: line up input 1 – 10 in Next · Enter: TAKE · Shift + Enter: CUT',
      '• F1 · F2 · F3: control the Live Screen · Back Screen · Monitor',
      '• Shift + 1 – 4: overlay 1 – 4 on / off · B: blank the screen you control',
      '• Space · → · Page Down: next slide · ← · Page Up: back',
      '• Ctrl + / Ctrl −: bigger / smaller text · Esc: close a window without saving',
      'Help → Keyboard shortcuts has the full list.',
      'Help → Check for updates: when a new Lumora is out, click Update now (not during an event). It installs and opens again by itself. Lumora also checks a few seconds after it opens.',
    ],
  },
];

/** Topics matching a search (every word must be found), best first. `jewish`: include the Jewish event tools. */
export function searchManual(q: string, jewish = true): Topic[] {
  const topics = jewish ? MANUAL : MANUAL.filter((t) => !t.jewish);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return topics;
  const score = (t: Topic) => {
    const title = t.title.toLowerCase();
    const keys = t.keywords.toLowerCase();
    const body = t.body.join(' ').toLowerCase();
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 5;
      else if (keys.includes(w)) s += 3;
      else if (body.includes(w)) s += 1;
      else return 0;
    }
    return s;
  };
  return topics
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

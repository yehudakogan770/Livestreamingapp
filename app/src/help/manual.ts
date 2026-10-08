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
      '• FTB (fade to black) fades the screen slowly out (and back up).',
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
    id: 'data',
    title: 'Titles from a spreadsheet or Google Sheet',
    keywords: 'data csv json spreadsheet excel google sheet sheets column row scores names speakers list scoreboard refresh',
    body: [
      'Titles and scoreboards can take their words from a spreadsheet: a list of speakers, scores, prices, anything. Change the sheet and the screen changes a moment later.',
      '1. Inputs → Data file (spreadsheet)….',
      '2. Choose a CSV file (in Excel: File → Save As → CSV), or paste a Google Sheet link and press Use this link. The first row names the columns.',
      '3. In a title, type a column name in curly brackets, like {Name} or {Role}. The buttons in the data window copy them for you.',
      '4. Pick the row the titles show: click it, use Previous row and Next row, or press [ and ] on the keyboard. The Stream Deck, Companion, the phone remote and macros can change the row too.',
      '• Google Sheets: share the sheet with “Anyone with the link” and paste its link (Lumora reads the tab in the link), or use File → Share → Publish to web → CSV. Published sheets can take a few minutes to show changes; shared links are quicker.',
      '• Read every: how often Lumora looks for changes. A file can be read every half second; a web link every 5 seconds or slower.',
      '• A scoreboard can follow columns too (home score, away score, period), set at the bottom of the data window.',
      'Tip: Keep one row per speaker or per moment of the event, in order, so ] moves the titles along with the program.',
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
    id: 'speaker-slides',
    title: 'Let the speaker change slides',
    keywords: 'speaker presenter clicker remote second device phone tablet laptop ipad notes black screen slides control from another device',
    body: [
      'The speaker can change the slides from their own phone, tablet or laptop. Their device shows the slide on the screen, the next one, their notes, a timer and the event’s countdown. It can only change the slides: it can’t switch cameras, go live or change anything else.',
      '1. Slideshow → Let the speaker change slides… (or Control from another device… in a slideshow’s settings).',
      '2. If the phone remote is off, click Turn on the phone remote.',
      '3. The speaker connects to the same Wi-Fi as this computer and points their camera at the code. It connects by itself. Or they open the short link and type the speaker PIN (it is not the phone remote’s PIN).',
      '4. On their device: Next and Back (big buttons), tap the slide for the next one, swipe left or right, or All slides to jump to any slide. A clicker paired with their laptop works too.',
      '• You always win: if you change the slide here, their device follows at once.',
      '• Pause speaker control stops them changing slides (they still see them). Click it again to let them back.',
      '• “Speaker is controlling slides (iPhone)” shows who is connected. Disconnect sends that device away until you choose a New speaker PIN.',
      '• Black screen: tick “The speaker may black out the slides” to let them use it. Black shows black where the slides are; the next click brings the slides back.',
      '• Notes: in a slideshow’s settings, type notes beside each slide. Only the speaker’s device shows them.',
      '• A stage manager can open the same page with the phone remote’s PIN (Slides, at the bottom of the phone remote).',
      'Tip: A presentation clicker plugged into this computer works too: Settings → Presentation clicker controls the slideshow. Page Down is next, Page Up is back, and B (or .) blacks out the slides.',
    ],
  },
  {
    id: 'sound',
    title: 'Sound and the audio mixer',
    keywords:
      'audio sound mixer volume microphone music mute speakers headphones ducking loudness lufs lu target ebu r128 eq equalizer gate compressor limiter delay lip sync',
    body: [
      'Every input with sound has a fader and a meter in the audio mixer. M mutes it.',
      '• The Stream, Hall and Recording mixes each have their own level (Speakers… chooses where each is heard). Each mix has a limiter, so it never distorts however far the faders go up.',
      '• A channel’s settings (the gear button on its strip): low cut, EQ (bass, middle, treble), noise gate, compressor, noise removal, and sound delay up to 1 second to line the sound up with a camera that is late.',
      '• Loudness: the number next to Speakers… is how loud the Stream mix is, in LUFS, over the last 3 seconds. Click it to choose a target: −14 for YouTube and most streaming, −16 for podcasts, −23 for TV. Green means on target; yellow says how many dB too quiet or too loud. It also shows the loudness of the whole event so far.',
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
      '• You can stream to several places at once. If one of them drops out, the others keep going, and Lumora tells you which one stopped.',
      '• RTMPS (rtmps://, used by Facebook and Vimeo) is encrypted RTMP. SRT (srt://192.168.1.50:9000) holds up better on poor internet and is what many encoders, receivers and cloud services take. For SRT, choose SRT as the service and put the stream ID in the key box if the receiver asks for one.',
      '• Backup server: under each destination you can add a second server for the same stream. YouTube has one built in (press “Use YouTube’s”). If the stream to one server fails, Lumora reconnects to the other with the same key.',
      '• If the internet drops, Lumora keeps trying by itself: after 2, 4, 8, 15 and then every 30 seconds. The LIVE button shows “Reconnecting (3)…” with the try it is on. The recording carries on the whole time; it is saved on this computer and never waits for the internet. Press the button to stop trying.',
    ],
  },
  {
    id: 'accounts',
    title: 'Going live with YouTube and Facebook accounts',
    keywords: 'youtube facebook account connect sign in oauth broadcast stream key watch link thumbnail made for kids latency dvr page live video health',
    body: [
      'Instead of copying a stream key, connect your YouTube or Facebook account once. Lumora then makes the broadcast, fills in the server and key, takes it live when you press GO LIVE and ends it when you stop. Destinations with a stream key keep working exactly as before; use whichever you like.',
      '1. Settings → Recording and streaming → “+ YouTube with your account” (or “+ Facebook with your account”).',
      '2. Click Connect. Your browser opens YouTube’s (Google’s) or Facebook’s own sign-in page — Lumora never sees your password. Allow what Lumora asks for, then come back to Lumora.',
      '3. YouTube: choose a broadcast planned in YouTube Studio, or “A new broadcast each time Lumora goes live” with its title, description, who can watch (public, unlisted or private), start time, delay (normal, low or ultra-low) and rewinding (DVR). YouTube requires an answer to “Is it made for kids?”.',
      '4. Facebook: choose the Page to go live on, and a title and description.',
      '5. Press GO LIVE. Next to the destination you see where the broadcast is (ready, testing, live, ended), the signal YouTube gets (good, OK, poor, no signal yet) and the watch link with a Copy button.',
      '• “Make the broadcast now” makes the YouTube broadcast ahead of time, so you can share the watch link before the event.',
      '• Thumbnail: choose a picture (JPG or PNG under 2 MB), or “Use the Live Screen now” for a picture of what is on the Live Screen. Custom thumbnails need a verified YouTube account (youtube.com/verify).',
      '• Taking it live: unless you tick “YouTube goes live by itself”, Lumora moves the broadcast from ready to testing to live as soon as YouTube gets the stream. If the internet drops, the broadcast stays open while Lumora reconnects; only stopping the stream ends it.',
      '• Backup: YouTube’s backup server is filled in by itself.',
      '• Facebook keeps a connection for only an hour or two: connect again shortly before the event if Lumora says it runs out soon. If the browser ends on a page that says “Success”, choose “Connect by pasting the address” and paste that page’s address.',
      '• The sign-in is kept in Windows Credential Manager on this computer (never in event files). Disconnect removes it.',
      'Tip: “Live streaming isn’t turned on for this channel” — turn it on at youtube.com/features (YouTube asks to verify a phone number); the first time, YouTube takes up to 24 hours. “Daily limit used up” — YouTube allows each copy of Lumora a set amount of work a day; until midnight Pacific time, use a destination with a stream key instead.',
      'Tip: “isn’t set up in this copy of Lumora yet” — the person who set up Lumora adds the Google and Meta app registrations once (see docs/LIVE_ACCOUNTS.md). Until then, stream keys work as always.',
    ],
  },
  {
    id: 'encoders',
    title: 'Encoders and quality',
    keywords:
      'encoder nvenc nvidia quick sync intel amd amf x264 software hardware gpu graphics card 4k 2160p 1080p60 60fps bitrate cbr keyframe hevc h.265 quality iso camera files fallback',
    body: [
      'An encoder squeezes the picture small enough to stream or save. Lumora can use the encoder built into your graphics card (NVIDIA, Intel or AMD), which takes the work off the processor, or the processor itself (“Software”).',
      '1. Open Settings → Recording and streaming… and find Encoder.',
      '2. Leave it on Automatic. Lumora checks your graphics card each time it starts and uses its encoder if it works; the note under the setting says what it found.',
      '3. Speed or quality: Balanced suits almost everyone. Choose Speed if the computer struggles, Quality if it has plenty to spare.',
      '• Streams always go out at a steady bitrate with a keyframe every 2 seconds, which is what YouTube, Facebook and Vimeo ask for.',
      '• 4K: set Picture to 4K and Stream picture to 1080p. Lumora draws the show once in 4K for the recording, and the graphics card makes the 1080p stream from it. 4K needs a strong computer with a graphics card; run Help → Check this computer first, and always try it in a Rehearsal.',
      '• 60 frames a second (1080p60, 4K60) looks smoother but is twice the work. If the frame rate in the bottom bar drops below its target, go back to 30.',
      '• Each destination can have its own bitrate (under its stream key). Destinations with the same bitrate share one encode, so keep them the same unless one really needs less.',
      '• “Encode recordings with this encoder” saves recordings at a constant quality instead of a fixed bitrate. HEVC (H.265) makes smaller files but needs a graphics card that can make it. Leave this off if you are not sure: the recording is then saved exactly as Lumora makes it, which is the safest.',
      '• Camera files (each camera recorded on its own) can be turned on or off for each input, with their own bitrate. They all start on the same clock as the main recording, so Lumora Studio lines them up by itself.',
      'If the graphics card’s encoder stops in the middle of an event, Lumora switches to the processor by itself and carries on. The stream comes back within a few seconds; a recording carries on in a new file next to the first one, and nothing already recorded is lost. A message in the bottom bar says so. Restart Lumora (and update the graphics driver) to use the graphics card again.',
      'You can see which encoder is working in the bottom bar: click the CPU button. The test event report lists it too.',
      'Tip: The processor’s encoder is fine for one 1080p30 stream on a good computer. For 1080p60, 4K, or several destinations at different bitrates, use a graphics card.',
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
      '• Stream Deck / Companion: buttons for takes, overlays, slides, the teleprompter, the backup lineup and more.',
      '• Presenter clickers move the slides (and the words of anything shown a part at a time).',
      '• Settings → MIDI controller…: faders and buttons on a MIDI desk.',
      'Help → Keyboard shortcuts lists every key.',
    ],
  },
  {
    id: 'control-api',
    title: 'Control API: Companion, OSC and tally lights',
    keywords: 'api companion bitfocus stream deck x-keys loupedeck osc udp websocket http tally light token script show control automation vmix atem qlab',
    body: [
      'The control API lets other gear and programs run Lumora: Bitfocus Companion (for Stream Deck, X-keys and Loupedeck), tally lights, show-control systems like QLab, and your own scripts.',
      '1. Open Settings → Control API (Companion, OSC, tally)….',
      '2. Turn on HTTP and WebSocket. The addresses other computers use are listed under it.',
      '3. Press Copy next to the token and paste it into Companion or your script. Every request must carry it.',
      '4. In Companion, add the Lumora connection (in the companion folder that comes with Lumora), type this computer’s address, the port and the token. Drag the ready-made buttons from Presets: inputs light red when on air and green when in Next.',
      '• What it can do: Take, Cut, put an input in Next or on air by number or name, overlays, black, recording, going live, replays, slides, presets, macros, the countdown and PANIC.',
      '• Tally: Lumora tells Companion and any WebSocket client the moment what is on air changes. A simple tally light can ask http://this-computer:8095/api/tally/3 and get program, preview or off.',
      '• OSC (for show-control systems): turn on OSC (UDP) and send /lumora/cut or /lumora/preview 3 to port 8096. OSC carries no token, so Lumora listens only to this computer unless you turn off “Only from this computer”. Do that only on a network you trust.',
      'Tip: Making a new token stops everything that used the old one. Do it if the token was shared with someone who should no longer have it.',
      'Every command is listed in docs/API.md, which comes with Lumora.',
    ],
  },
  {
    id: 'operators',
    title: 'Run a show with two operators',
    keywords:
      'operators seats second operator two computers join show network graphics audio replay cameras director role laptop multi-operator team lan pair code',
    body: [
      'One computer runs the show: the cameras, the screens, the recording and the stream. This is the show computer. Other computers with Lumora on the same network can join it as seats, so one person runs the graphics, another the mixer, another the replays, while the show computer stays in charge.',
      'On the show computer:',
      '1. Settings → Operators…, then turn on “Let other computers join this show”.',
      '2. When someone asks to join, Lumora shows their computer’s name and a 6-digit code. Read the code to them (or let them see it).',
      '3. Choose their seat and click Let in. They join as soon as they type the code.',
      'On the other computer:',
      '1. Settings → Join a show on this network….',
      '2. Click Join next to the show. If it isn’t listed, type the show computer’s address (shown in its Operators window, like 192.168.1.20).',
      '3. Type the code shown on the show computer. Once you are let in, the seat window opens: “Connected to <show> as Graphics”, with Leave at the top right.',
      'The seats:',
      '• Director: everything a seat can do.',
      '• Graphics: overlays, titles and lower thirds, scoreboards, countdowns, song lyrics, slides and data titles. No camera cuts, going live or recording.',
      '• Audio: the mixer only, with its level meters.',
      '• Replay: instant replay only.',
      '• Cameras: PTZ moves and presets, and what is lined up in Next.',
      '• Custom: tick exactly what this seat may do.',
      'A seat sees the whole show. What its seat can’t do is greyed out; hold the pointer over it to see “Your seat can’t do this”. The show computer checks every request itself, so a seat can never do more than its role.',
      'In Settings → Operators… you see each seat with its delay (a few milliseconds on a wired network). Change its role at any time. Lock stops a seat from changing anything (it keeps watching); Unlock lets it carry on. Remove disconnects it, and it has to join again with a new code.',
      '• Nobody at a seat can open or close the show computer’s screens, change where it records, open files or change its settings.',
      '• If a seat’s network drops, nothing happens to the show. The seat reconnects by itself and catches up, with no new code.',
      '• Everything between the computers is encrypted, and it works on the venue network with no internet.',
      '• The pictures at a seat are small copies, a few times a second: good for knowing what is on air, not for judging focus. With the Unified engine (Settings → Engine…) the seat gets every input’s picture; with the Standard engine it gets what the show computer is showing on its own screen.',
      'Tip: Use a wired network or a dedicated router for the show computer and the seats. Guest Wi-Fi often keeps computers from seeing each other; if the show isn’t listed, type its address.',
      'Tip: If the show computer’s firewall asks whether Lumora may use the network, allow it on private networks, or seats can’t join.',
    ],
  },
  {
    id: 'blackmagic-cards',
    title: 'Blackmagic capture cards: SDI and HDMI',
    keywords:
      'blackmagic decklink ultrastudio intensity sdi hdmi capture card desktop video embedded audio channels timecode interlaced 1080i program out playout projector recorder',
    body: [
      'Blackmagic DeckLink, UltraStudio and Intensity cards bring professional cameras into Lumora over SDI or HDMI, with the sound carried on the cable.',
      '1. Install Blackmagic Desktop Video (free from blackmagicdesign.com/support, under Capture and Playback), restart the computer, and check the card shows in Blackmagic Desktop Video Setup. Lumora uses it directly; nothing else is needed.',
      '2. Add input → Blackmagic capture card. Lumora lists the cards in this computer. A card with two or more inputs (a DeckLink Duo, for example) shows each as its own card.',
      '3. Choose the input (SDI or HDMI) when the card has both, and the pair of audio channels to hear. SDI can carry 16 channels: a sound desk often sends its mix on channels 1 and 2.',
      '4. Press Add input. The picture appears as soon as the camera is on. The card finds the format by itself: 1080i, 1080p, 720p or 4K, at any frame rate.',
      '• The input’s settings (Edit on its tile) show the format the card sees, the audio channels, and the timecode when the camera sends one.',
      '• If Lumora says Desktop Video isn’t installed, install it as in step 1. If it says the card is in use, close Blackmagic Media Express, OBS or any other program using it.',
      '• No signal: check the cable, that the camera is on, and that the camera sends a format the card takes (an older card may need the camera set to 1080i59.94).',
      '• Program out: with the Unified engine on (Settings → Engine), Settings → Blackmagic program out… plays the Live Screen on a card’s SDI or HDMI output, for a projector, a recorder or a switcher. Choose the card and the format, then Start program out.',
      'Tip: Each card input is opened once, however many screens and previews show it, in both engines.',
    ],
  },
  {
    id: 'atem',
    title: 'ATEM switchers',
    keywords:
      'atem blackmagic switcher mini constellation television studio vision mixer cut auto preview program fade to black ftb dsk usk keyer macro tally follow drive mapping ip address',
    body: [
      'Lumora can work with a Blackmagic ATEM switcher on the same network: switch it from Lumora, or follow it and light its cameras’ tally.',
      '1. Find the switcher’s IP address: on the switcher (Settings → Network) or in ATEM Setup on a computer connected to it.',
      '2. Settings → ATEM switcher…. Type the address and press Connect. Lumora shows the switcher’s name when it is connected, and connects again by itself if the switcher restarts or the network drops.',
      '3. Under Lumora input and ATEM input, choose which ATEM input each Lumora input is. Match by name pairs inputs with the same name (Camera 1 with Camera 1).',
      '• The switcher’s own buttons are in the dialog: Program, Preview, Cut, Auto, the transition (Mix, Dip, Wipe, DVE, Stinger) and its length, Fade to black, the keyers and the macros.',
      '• Lumora drives the ATEM: TAKE, CUT and Next on Lumora’s Live Screen switch the ATEM too, for the inputs in the table. The ATEM uses its own transition at Lumora’s length (a fade becomes a mix, a dip a dip, a wipe a wipe), or always a cut if you choose that. Lumora’s fade to black can fade the ATEM too.',
      '• Follow the ATEM’s tally: what the ATEM has on program and preview lights Lumora’s inputs of the same cameras, for tally lights, Companion and the control API.',
      '• When the ATEM’s program output comes into Lumora on a capture card, choose that input under “The ATEM’s program comes into Lumora on”. The ATEM’s cameras then count as on air only while that input is on air in Lumora.',
      '• Stream Deck and Companion: the control API’s atem command, for example /api/do/atem?do=cut, do=auto, do=program&input=2, do=ftb, do=dsk&keyer=1, do=macro&number=3 or do=macro&name=Intro.',
      'Tip: An ATEM takes a limited number of connections at once. If Lumora says the switcher is full, close ATEM Software Control on another computer.',
    ],
  },
  {
    id: 'macros',
    title: 'Macros: several steps with one button',
    keywords: 'macro sequence automation steps wait delay hotkey shortcut schedule time of day record stream companion',
    body: [
      'A macro is a list of steps run one after another, with waits in between. For example: start recording, wait 2 seconds, go live, put the countdown on air.',
      '1. Cues → Macros (several steps with one button)….',
      '2. Add a macro and give it a name.',
      '3. Add its steps, or press Record steps and do the steps yourself: everything you do is written down, with the time between each step, until you press Stop recording.',
      '4. Run it with Run now, its key (for example Ctrl+1 or F7), a preset button, the Stream Deck (Lumora’s Macro key, or Companion), the control API, or every day at a set time.',
      '• A step can switch inputs, show overlays and titles, change sound, run a preset, start or stop recording and the stream, make a replay, or run another macro.',
      '• A macro can have up to 50 steps, and each wait can be up to 10 minutes.',
      'Tip: Try a new macro in a Rehearsal before the event.',
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
      '• If the camera on air goes out, the backup lineup switches to the next camera by itself (see “Backup lineup: if a camera goes out”).',
      '• Blank Live / Back / Monitor: that screen goes black (B for the one you control).',
      '• All good (bottom left) turns yellow or red when something needs attention; click it to see what.',
      '• CPU and graphics use are shown at the bottom; if they are high, close other programs.',
    ],
  },
  {
    id: 'backup',
    title: 'Backup lineup: if a camera goes out',
    keywords: 'backup lineup failover camera lost unplugged no signal frozen dropped stream ndi spare switch automatic',
    body: [
      'If the camera on air goes out (it is unplugged, stops sending pictures, or a stream or NDI source drops), Lumora switches to the next camera in your backup lineup by itself, in about a second and a half. It skips any that are out too. If none has a picture, the audience sees your logo.',
      'It is on from the start. With two or more cameras the lineup is automatic: your cameras in the order of your inputs, then the logo.',
      '1. Settings → Backup lineup… (also in a camera’s ⋯ menu, and in Adjust picture…).',
      '2. To choose the order yourself, pick My own order. Move inputs up and down, take them out, or add another one, such as a wide shot or a slide.',
      '3. Choose the screens it looks after (Live, Back, Monitor), how long without a picture counts as lost, and a cut or a quick fade.',
      'When it switches, a notice at the top says so, for example “Camera 1 lost: switched to Camera 2”, with the time. The camera’s tile says No signal, and the problem light lists it.',
      'When the camera comes back, Lumora does not switch back by itself. The notice says “Camera 1 is back”; click Take Camera 1 when you are ready. Turn on Switch back by itself when it returns if you prefer.',
      '• Your own take always wins: right after you take something, the lineup waits, and it never switches back and forth.',
      '• If the camera in Next goes out, its tile and the Next monitor say No signal.',
      '• Try it (in the Backup lineup window) pretends the camera on air lost its picture for 6 seconds. Use it during a rehearsal. The test event checks it too.',
      '• A Stream Deck key turns the lineup on and off.',
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

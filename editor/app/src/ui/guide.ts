// Studio's help topics: how the finishing tools work, in plain words. Shown
// by Help > Help topics; each topic is a few short paragraphs.

export interface GuideTopic {
  id: string;
  title: string;
  /** Where to find it in Studio. */
  where: string;
  paragraphs: string[];
}

export const GUIDE: GuideTopic[] = [
  {
    id: 'interchange',
    title: 'Working with other editors',
    where: 'File > Export timeline for other editors, and File > Import a timeline',
    paragraphs: [
      'You can send a sequence to Final Cut Pro, Premiere Pro, DaVinci Resolve or Avid, and bring theirs in. Choose the format the other program reads: FCPXML for Final Cut Pro and Resolve, XML for Premiere Pro and Resolve, EDL for almost any editor (one video track, cuts and dissolves only), and OpenTimelineIO (.otio) for tools that use it.',
      'The file carries the edit: clips, where they start and end, tracks, speed changes, dissolves, markers and the sequence settings. Effects, titles and grades made in Studio stay in Studio, and the export dialog lists what will not travel.',
      'When you import a timeline, Studio makes a new sequence and looks for each clip by its path. If a file has moved, choose a folder and Studio finds it there by file name. Anything still missing comes in as offline; link it later with File > Find missing files.',
    ],
  },
  {
    id: 'luts',
    title: 'LUTs',
    where: 'Inspector > Effects > LUT (look), and the Color page',
    paragraphs: [
      'Add the LUT (look) effect to a clip and choose a .cube file. Studio reads 3D LUTs of any size, including the common 17, 33 and 65 point ones. Use Amount to blend the LUT with the original picture.',
      'For log footage, choose your camera under Camera log to turn it into normal-looking Rec. 709 without a separate file.',
      'To use your grade somewhere else (a camera, an on-set monitor or another editor), select the clip on the Color page and choose Export LUT. Pick 17 points for cameras and monitors, 33 for most software, or 65 for finishing (the most accurate copy). Windows, keys and blur cannot be part of a LUT, so only the overall color is saved.',
    ],
  },
  {
    id: 'exposure',
    title: 'False color and zebra stripes',
    where: 'The Exposure button under the program viewer',
    paragraphs: [
      'False color paints the picture by brightness so you can judge exposure at a glance: purple and blue are crushed shadows, green is middle gray, pink is a good skin tone, and yellow and red are close to clipping. A scale under the viewer shows how much of the frame falls in each band.',
      'Zebra stripes mark everything brighter than the level you choose (95% by default). Use 100% to see only clipped areas, or 70% to check skin tones. Neither overlay is ever exported.',
    ],
  },
  {
    id: 'loudness',
    title: 'Loudness and sound-only exports',
    where: 'Export > Sound, and the render queue',
    paragraphs: [
      'Each place your video goes expects a certain loudness. Choose a target and Studio adjusts the whole mix to it while it exports: −14 LUFS for YouTube and social media, −16 LUFS for podcasts, −23 LUFS for broadcast (EBU R128), or −24 LUFS for US broadcast (ATSC A/85). The true peak is kept below −1 dBTP (−2 dBTP for broadcast) so nothing distorts after the file is compressed.',
      'When the export finishes, Studio measures the file and the render queue shows a report: the integrated loudness, true peak and loudness range, and whether it meets the target.',
      'To export only the sound, choose one of the Sound presets: WAV (24-bit, uncompressed), broadcast WAV, MP3, podcast MP3 or AAC (.m4a). If your sound tracks are marked as dialogue, music or effects, check Also save stems to get a separate file for each, lined up to the same start.',
    ],
  },
  {
    id: 'delivery',
    title: 'Delivery presets',
    where: 'File > Export (Ctrl+M)',
    paragraphs: [
      'Presets set the size, codec, quality and loudness for each destination: YouTube 1080p and 4K (H.264 or H.265), YouTube Shorts, Instagram Reels, Stories and square posts, TikTok, Facebook, X, LinkedIn and Vimeo.',
      'For masters and handoff, use ProRes 422 HQ, ProRes 4444 (keeps transparency), DNxHR HQ, DNxHR HQX (10-bit) or H.265 10-bit. These are large files meant for archiving or for another program, not for uploading.',
      'A vertical preset on a wide sequence crops the middle. If people move around the frame, use Auto reframe from the export dialog to make a vertical version that follows them.',
      'You can keep editing while exports run. Add several to the render queue and Studio works through them in order, then tells you with a notification when each one is done.',
    ],
  },
  {
    id: 'captions',
    title: 'Captions, chapters and thumbnails',
    where: 'File > Export (Ctrl+M)',
    paragraphs: [
      'Captions can be burned into the picture (always visible, works everywhere), put in the file as a subtitle track viewers can turn on, or saved next to the video as .srt and .vtt files to upload separately. You can choose more than one.',
      'Markers become chapters. MP4 and MOV files get chapters players can jump to, and Copy for YouTube puts a list of times and titles on the clipboard to paste into the video description. YouTube needs the first chapter at 0:00 and at least three chapters of 10 seconds or more.',
      'To save a thumbnail, choose a marker under Thumbnail. Studio saves that frame as a JPEG next to the video when the export finishes.',
    ],
  },
  {
    id: 'formats',
    title: 'Camera formats',
    where: 'File > Import (Ctrl+I), or drag files onto the media pool',
    paragraphs: [
      'Studio opens the formats professional cameras record: ProRes, DNxHD and DNxHR, AVC-Intra and XAVC, 10-bit H.264 and H.265 (HEVC), MXF from broadcast cameras, and high frame rate clips such as 120 or 240 fps. Heavy files get a light copy for smooth playback; your export always uses the original.',
      'Phones and screen recorders often record at a frame rate that changes from moment to moment. Studio makes a steady-rate copy so sound stays in sync, and tells you when it does.',
      'Drop or choose a numbered image sequence (ten or more frames such as plate_0001.dpx, plate_0002.dpx) and it comes in as one clip at the sequence frame rate. Studio saves it next to the frames as a ProRes 422 HQ file so DPX and EXR plates keep room to grade.',
      'Camera RAW files (Blackmagic RAW .braw, RED .r3d, ARRIRAW .ari, Canon Cinema RAW Light .crm and Nikon N-RAW .nev) cannot be opened directly. Studio tells you which free program converts them. Convert them to ProRes 422 HQ or DNxHR HQX and import the converted files.',
    ],
  },
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
  {
    id: 'multicam-files',
    title: 'Multicam from separate files',
    where: 'Sequence > New multicam clip from files, or right-click a file in the media pool',
    paragraphs: [
      'Tick the cameras and any separate sound recorders that filmed the same thing. Studio lines them up and makes one multicam clip, with a new sequence that plays it. Then cut between the cameras in the camera wall (press 1, 2, 3…), or let Smart > Auto multicam edit cut by who is talking.',
      'Line up by Sound compares what every microphone heard and is accurate to a hundredth of a second; a clap at the start helps but is not needed. Timecode uses the time code the cameras wrote (set them to the time of day). Recording time uses when each camera says it started, to the second. Starts puts every file at the same moment.',
      'A file marked "Check this one" did not match clearly. Watch it in the camera wall and move it a frame at a time with the − and + buttons. Files with Sound ticked go on the timeline; the other cameras’ sound still helps Auto multicam edit.',
    ],
  },
  {
    id: 'caption-looks',
    title: 'Caption looks and words that light up',
    where: 'Select a caption, then the Inspector: Caption look (the whole track)',
    paragraphs: [
      'Choose a ready-made look: Broadcast and Clean for any video, or Highlight, Karaoke, Word box, Pop and Reveal for social clips, where each word lights up as it is said. Change the accent color, capitals, font, size, outline and place as you like; the look applies to the whole captions track.',
      'Captions made from the transcript know when each word is said. Typed captions share their time out by the length of each word. Fixing a spelling keeps the timing; adding or removing words works it out again.',
      'Shorter lines suit vertical video. After changing Letters a line or Lines, choose Make them again from the transcript to break the track’s captions again (changes typed into them are replaced).',
    ],
  },
  {
    id: 'social-clips',
    title: 'Clips for social',
    where: 'Smart > Clips for social',
    paragraphs: [
      'Studio finds the moments that stand on their own: whole sentences, a strong opening line, the room reacting, your key words and highlight markers. Each one gets a strength from 1 to 99 compared with the rest of the sequence. Click a time to watch it, and untick any you don’t want.',
      'Each clip you keep becomes its own sequence in the shape you choose, with captions in the look you choose and, if asked, its first line as a title. Follow the people talking frames the picture on faces, the way Auto reframe does. Export each one when made puts them all in the render queue for YouTube Shorts, Instagram or TikTok.',
      'Everything is worked out on this computer, so there is no limit on how many you make.',
    ],
  },
  {
    id: 'finish-event',
    title: 'Finish the event in one step',
    where: 'Smart > Finish the event',
    paragraphs: [
      'For a recorded event, Finish the event runs the Smart tools in order: it cuts between the cameras by who is talking, writes down what is said, adds captions and chapter markers, makes a highlight reel and clips for social, and can put everything in the render queue. The event goes to the queue for YouTube with chapters and a captions file; the reel and clips get their captions in the picture.',
      'Choose what you want before pressing Finish. Steps that can’t run (for example, no multicam clip) are skipped and you are told why. Everything it makes is one change, so a single Undo takes it all back.',
    ],
  },
  {
    id: 'script-cut',
    title: 'Rough cut from a script',
    where: 'Smart > Rough cut from a script',
    paragraphs: [
      'Paste the script, or a list of what should be said in order, or open a text file. Studio looks for every line in what was said in all the transcribed recordings, takes the closest take of each, and lays them out in the script’s order on a new sequence.',
      'Other good takes of a line go on the hidden Alt tracks above it, so you can swap one in by moving it down. A line that was never said gets a red marker where it would go. Transcribe the recordings first.',
    ],
  },
  {
    id: 'transcript',
    title: 'Editing by the transcript',
    where: 'The Transcript tab',
    paragraphs: [
      'Click a word to go there. Drag across words and press Delete to cut them out of every track and close the gap. Delete fillers takes out every um, uh and hmm at once (they are underlined in the transcript).',
      'When more than one microphone or file is heard, the transcript starts a new paragraph for each change of voice and shows who is speaking. Click the name to give the person their real name.',
    ],
  },
  {
    id: 'mixer',
    title: 'The mixer: EQ, dynamics, buses and fader moves',
    where: 'View > Audio page',
    paragraphs: [
      'Each sound track has EQ (low and high shelves, two bells and a low cut), Dynamics (a compressor with make-up gain) and a Limiter. The EQ, Dyn and Lim buttons on a strip show what is switched on; choose the strip’s name to set them, with the curves drawn as you change them. Clips’ own effects come first, then the track’s, then its bus’s, then the whole mix’s.',
      'A bus mixes the tracks sent to it (choose To a bus under the fader), so all the dialogue or all the music can be processed and leveled together. The Everything strip has the whole mix’s processing and level, which the film gets; its fader is only how loud you listen.',
      'To record fader moves, switch on the pen button under a track and play the film: moving the fader records it until you let go, replacing what was there for that stretch. The fader then follows its moves while editing and in the film. Moving it when not recording moves the whole line up or down; Clear in the strip panel takes the moves away.',
    ],
  },
  {
    id: 'match-loudness',
    title: 'Matching loudness and recording a voiceover',
    where: 'Clip > Match loudness of the selected clips, and Sequence > Record a voiceover',
    paragraphs: [
      'Select two or more sound clips and choose Match loudness: each clip’s loudness is measured on the part it plays (quiet gaps don’t count) and its volume is moved to the middle one’s. Volume lines move as a whole.',
      'To record a voiceover, put the playhead where it should start and choose Record a voiceover. Pick the microphone, check its level, and press Record: after a count of three the film plays while you speak (use headphones). Stop and keep puts the take on the Voiceover track where it started. Takes are kept in Documents/Lumora/Voiceovers.',
    ],
  },
  {
    id: 'publish',
    title: 'Publishing to YouTube',
    where: 'The render queue: Publish to YouTube on a finished export',
    paragraphs: [
      'Connect your channel once (your browser opens Google’s sign-in). A channel connected in Lumora is already connected here too. Then choose the title, description, tags, category, who can see it and whether it is made for kids. Chapter markers fill the start of the description in the form YouTube turns into chapters.',
      'If the export has a thumbnail and a captions file, they are added to the video too. The upload goes a piece at a time and carries on by itself if the connection drops; you can close the window and keep editing while it runs, and the queue shows how far it has got. Videos start as Only me unless you choose otherwise.',
    ],
  },
  {
    id: 'stills',
    title: 'Stills and the reference wipe',
    where: 'The Stills button over the viewer on the Color page',
    paragraphs: [
      'Grab a still of a shot you like, then go to another shot and choose the still: it shows over the picture left of a line you can drag (or move with the arrow keys). Match the shots by eye, with the scopes, or start with AI > Auto color match.',
      'Stills last while Studio is open. Grab as many as you need; the oldest go after 24.',
    ],
  },
  {
    id: 'library',
    title: 'Transitions, effects and titles',
    where: 'Effects and Text & more in the media panel',
    paragraphs: [
      'There are 37 video transitions in six groups: dissolves, wipes (including clock, diagonal and blinds), slides and pushes, shapes (iris, box, barn doors), motion (zooms, whip pans, spin) and 3D (cube and flip). Drag one onto a cut, or put the playhead on a cut and press Ctrl+D.',
      'Picture effects include color tools, keys and masks (including a rounded rectangle for picture-in-picture), blurs, video noise reduction, skin smoothing, clarity, tint, duotone, cinematic bars, mirror, tilt-shift, lens distortion and camera shake. All of them are drawn on the graphics card, the same way in the viewer and in the film.',
      'Text & more has over 45 motion title templates, including an Event group (welcome, program, sponsors, back soon, award winner, next speaker) and titles whose words come in one after another, plus the Lumora Titler designs.',
    ],
  },
];

/** Topics whose title or text has every word in `query` (case doesn't matter). */
export function searchGuide(query: string, topics: readonly GuideTopic[] = GUIDE): GuideTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...topics];
  return topics.filter((t) => {
    const text = [t.title, t.where, ...t.paragraphs].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

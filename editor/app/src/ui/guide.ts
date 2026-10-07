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

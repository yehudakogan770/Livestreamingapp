// Operator seats: the roles the show operator gives other computers, and
// what each may do. The same groups as crates/seats/src/role.rs — the show
// computer checks every request there; this copy only greys out controls.

export type Group =
  | 'switching'
  | 'preview'
  | 'cameras'
  | 'overlays'
  | 'titles'
  | 'scoreboards'
  | 'countdowns'
  | 'lyrics'
  | 'slides'
  | 'data'
  | 'audience'
  | 'audio'
  | 'replay'
  | 'recording'
  | 'playback'
  | 'inputs'
  | 'runOfShow'
  | 'stage'
  | 'eventSettings';

export type RoleKind = 'director' | 'graphics' | 'audio' | 'replay' | 'cameras' | 'custom';

export type Role = { kind: Exclude<RoleKind, 'custom'> } | { kind: 'custom'; groups: Group[] };

/** Every group, in the order the Custom list shows them, with what it covers. */
export const GROUPS: { id: Group; name: string; hint: string }[] = [
  { id: 'switching', name: 'Switching', hint: 'TAKE, CUT, the fader, transitions, blank, fade to black, panic, presets' },
  { id: 'preview', name: 'What’s in Next', hint: 'Line up an input in Next' },
  { id: 'cameras', name: 'Cameras', hint: 'PTZ moves and presets, each camera’s settings' },
  { id: 'overlays', name: 'Overlays', hint: 'Overlay channels on and off' },
  { id: 'titles', name: 'Titles and lower thirds', hint: 'Titles, designed graphics, credits, scripture, comments' },
  { id: 'scoreboards', name: 'Scoreboards', hint: 'Scores and the game clock' },
  { id: 'countdowns', name: 'Countdowns', hint: 'Start, pause, add time' },
  { id: 'lyrics', name: 'Song lyrics', hint: 'Next and previous slide, blank' },
  { id: 'slides', name: 'Slideshows', hint: 'Next and previous slide, black' },
  { id: 'data', name: 'Data titles', hint: 'Which row of the data file titles show' },
  { id: 'audience', name: 'Audience', hint: 'Polls, raffles, the messages wall, auctions, trivia, questions' },
  { id: 'audio', name: 'Audio mixer', hint: 'Volumes, mutes, the mixes' },
  { id: 'replay', name: 'Instant replay', hint: 'Keep the last minute, replay it into Next' },
  { id: 'recording', name: 'Recording and going live', hint: 'REC, GO LIVE, rehearsal' },
  { id: 'playback', name: 'Video playback', hint: 'Play, pause, seek, playlists' },
  { id: 'inputs', name: 'Inputs', hint: 'Add, change and remove inputs' },
  { id: 'runOfShow', name: 'Run of show and macros', hint: 'Cues, macros and triggers (they can do anything they were set up to)' },
  { id: 'stage', name: 'Stage', hint: 'Stage monitor, teleprompter, stage visuals' },
  { id: 'eventSettings', name: 'Event settings', hint: 'Event look, backup lineup, captions, multiview' },
];

export const ALL_GROUPS: Group[] = GROUPS.map((g) => g.id);

export const ROLES: { kind: RoleKind; name: string; hint: string }[] = [
  { kind: 'director', name: 'Director', hint: 'Everything a seat can do' },
  {
    kind: 'graphics',
    name: 'Graphics',
    hint: 'Overlays, titles, lower thirds, scoreboards, countdowns, lyrics, slides, data titles. No camera cuts, going live or recording.',
  },
  { kind: 'audio', name: 'Audio', hint: 'The mixer only' },
  { kind: 'replay', name: 'Replay', hint: 'Instant replay only' },
  { kind: 'cameras', name: 'Cameras', hint: 'PTZ and camera controls, and what’s lined up in Next' },
  { kind: 'custom', name: 'Custom', hint: 'Only the groups you tick' },
];

/** The groups a role includes. */
export function roleGroups(role: Role): Group[] {
  switch (role.kind) {
    case 'director':
      return ALL_GROUPS;
    case 'graphics':
      return ['overlays', 'titles', 'scoreboards', 'countdowns', 'lyrics', 'slides', 'data'];
    case 'audio':
      return ['audio'];
    case 'replay':
      return ['replay'];
    case 'cameras':
      return ['cameras', 'preview'];
    case 'custom':
      return ALL_GROUPS.filter((g) => role.groups.includes(g));
  }
}

export function roleAllows(role: Role, group: Group): boolean {
  return roleGroups(role).includes(group);
}

export function roleName(role: Role): string {
  return ROLES.find((r) => r.kind === role.kind)?.name ?? 'Custom';
}

/** A role from the role picker (Custom keeps its ticked groups). */
export function makeRole(kind: RoleKind, groups: Group[] = []): Role {
  return kind === 'custom' ? { kind, groups } : { kind };
}

/** What a disabled control says when the seat's role doesn't include it. */
export const NOT_YOUR_SEAT = 'Your seat can’t do this';

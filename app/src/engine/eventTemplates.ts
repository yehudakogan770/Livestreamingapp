// Event templates: a ready start for a kind of event, offered in the event
// setup the first time. A template adds the inputs that kind of event needs
// (countdown, titles, scoreboard…), stage-monitor quick messages that fit it,
// and a run of show to fill in. Everything it adds can be changed or removed.

import { defaultCountdown } from './client';
import { defaultCredits } from './credits';
import { newRoom } from './guest';
import { defaultPoll } from './poll';
import { defaultScoreboard } from './score';
import { defaultSeating } from './seating';
import { TEXT_TEMPLATES } from './text';
import { defaultWall } from './wall';
import type { Action } from './types/Action';
import type { Cue } from './types/Cue';
import type { NewSource } from './types/NewSource';
import type { Show } from './types/Show';
import type { SourceKind } from './types/SourceKind';
import type { Step } from './types/Step';
import type { TextLayout } from './types/TextLayout';
import type { Trigger } from './types/Trigger';

export type TemplateId = 'conference' | 'concert' | 'wedding' | 'sports' | 'panel' | 'webinar';

export interface EventTemplate {
  id: TemplateId;
  name: string;
  /** One line under the name. */
  blurb: string;
  /** What it adds, in plain words (shown before choosing). */
  adds: string[];
}

export const TEMPLATES: EventTemplate[] = [
  {
    id: 'conference',
    name: 'Conference',
    blurb: 'Talks one after another, speaker names, a break',
    adds: ['“Starting soon” countdown', 'Event title', 'Speaker lower third', '“Please take your seats”', 'Thank-you credits', 'Speaker-timing messages'],
  },
  {
    id: 'concert',
    name: 'Concert',
    blurb: 'Music, stage visuals, song titles',
    adds: ['“Show starts in” countdown', 'Stage visuals', 'Song lower third', 'Sponsor ticker', 'Credits', 'Band messages'],
  },
  {
    id: 'wedding',
    name: 'Wedding',
    blurb: 'Ceremony, speeches, messages from guests',
    adds: ['Ceremony countdown', 'Couple’s names', 'Speech lower third', 'Messages from guests', 'Table finder', 'Thank-you credits'],
  },
  {
    id: 'sports',
    name: 'Sports',
    blurb: 'Scoreboard with game clock, player names',
    adds: ['Scoreboard with game clock', 'Kickoff countdown', 'Player lower third', 'Scores ticker', '“Halftime” card', 'Game messages'],
  },
  {
    id: 'panel',
    name: 'Panel',
    blurb: 'Several speakers, audience questions and a poll',
    adds: ['Countdown', 'Moderator and three panelist lower thirds', 'Audience poll', 'Panel-timing messages'],
  },
  {
    id: 'webinar',
    name: 'Webinar',
    blurb: 'A host and remote guests, chat on screen',
    adds: ['Countdown that starts when you go live', 'Remote guest', 'Chat comments on screen', 'Host lower third', 'Audience poll'],
  },
];

interface Plan {
  inputs: { name: string; kind: SourceKind }[];
  quick: string[];
  cues: [section: string, name: string][];
  /** The countdown goes on air and starts when the stream starts. */
  startOnLive?: boolean;
}

const text = (layout: TextLayout, words: string, sub = ''): SourceKind => {
  const t = TEXT_TEMPLATES.find((x) => x.layout === layout) ?? TEXT_TEMPLATES[0]!;
  return { type: 'text', ...t.make(), text: words, sub };
};

const countdown = (minutes: number, label: string): SourceKind => ({
  type: 'countdown',
  background: '#1c1f24',
  timer: { ...defaultCountdown(), lengthMs: minutes * 60_000, remainingMs: minutes * 60_000, label },
});

const credits = (title: string, names: string[]): SourceKind => ({ type: 'credits', ...defaultCredits(), title, names });

function plan(id: TemplateId): Plan {
  switch (id) {
    case 'conference':
      return {
        inputs: [
          { name: 'Starting soon', kind: countdown(10, 'Starting soon') },
          { name: 'Event title', kind: text('title', '[Event name]', '[Date · place]') },
          { name: 'Speaker name', kind: text('lowerThird', '[Speaker name]', '[Title, organization]') },
          { name: 'Take your seats', kind: text('fullScreen', 'Please take your seats') },
          { name: 'Thank you', kind: credits('Thank you', ['[Our sponsors]', '[Our speakers]', '[Our volunteers]']) },
        ],
        quick: ['10 minutes left', '5 minutes left', '2 minutes left', 'Please wrap up', 'Speak louder', 'Questions next', 'Stand by', 'Thank you!'],
        cues: [
          ['Opening', 'Doors open'],
          ['Opening', 'Welcome'],
          ['Talks', 'Keynote'],
          ['Talks', 'Break'],
          ['Talks', 'Second talk'],
          ['Closing', 'Questions'],
          ['Closing', 'Thank you'],
        ],
      };
    case 'concert':
      return {
        inputs: [
          { name: 'Show starts in', kind: countdown(15, 'The show starts in') },
          { name: 'Stage visuals', kind: { type: 'visuals' } },
          { name: 'Song title', kind: text('lowerThird', '[Song title]', '[Artist]') },
          { name: 'Sponsors', kind: text('ticker', '[Thank you to our sponsors]') },
          { name: 'Credits', kind: credits('Thank you', ['[Band]', '[Sound and lights]', '[Our sponsors]']) },
        ],
        quick: ['Next song', 'Two more songs', 'Last song', 'Encore is ready', '5 minutes left', 'Check your mic', 'Stand by', 'Thank you!'],
        cues: [
          ['Opening', 'Doors open'],
          ['Opening', 'Opening act'],
          ['Show', 'Main set'],
          ['Show', 'Encore'],
          ['Closing', 'Credits'],
        ],
      };
    case 'wedding':
      return {
        inputs: [
          { name: 'Ceremony begins', kind: countdown(15, 'The ceremony begins in') },
          { name: 'Couple', kind: text('title', '[Name] & [Name]', '[Date · place]') },
          { name: 'Speech', kind: text('lowerThird', '[Speaker name]', '[Relationship]') },
          { name: 'Messages', kind: { type: 'wall', ...defaultWall(), title: 'Messages for the couple', prompt: 'Send the couple a message' } },
          { name: 'Table finder', kind: { type: 'seating', ...defaultSeating() } },
          { name: 'Thank you', kind: credits('Thank you for celebrating with us', ['[Family]', '[Friends]']) },
        ],
        quick: ['Processional next', 'Vows next', 'Speeches next', 'First dance next', 'Please wrap up', '5 minutes left', 'Stand by', 'Thank you!'],
        cues: [
          ['Ceremony', 'Guests arrive'],
          ['Ceremony', 'Processional'],
          ['Ceremony', 'Vows'],
          ['Reception', 'Speeches'],
          ['Reception', 'First dance'],
          ['Reception', 'Thank you'],
        ],
      };
    case 'sports':
      return {
        inputs: [
          { name: 'Scoreboard', kind: { type: 'scoreboard', ...defaultScoreboard() } },
          { name: 'Kickoff', kind: countdown(10, 'Kickoff in') },
          { name: 'Player', kind: text('lowerThird', '[Player name]', '[Number · position]') },
          { name: 'Scores', kind: text('ticker', '[Scores from around the league]') },
          { name: 'Halftime', kind: text('fullScreen', 'Halftime') },
        ],
        quick: ['Halftime in 2 minutes', 'Timeout', 'Replay next', 'Interview next', '5 minutes left', 'Please wrap up', 'Stand by', 'Thank you!'],
        cues: [
          ['Pregame', 'Welcome'],
          ['Pregame', 'Lineups'],
          ['Game', 'First half'],
          ['Game', 'Halftime'],
          ['Game', 'Second half'],
          ['Postgame', 'Highlights and interviews'],
        ],
      };
    case 'panel':
      return {
        inputs: [
          { name: 'Starting soon', kind: countdown(5, 'Starting soon') },
          { name: 'Moderator', kind: text('lowerThird', '[Moderator name]', 'Moderator') },
          { name: 'Panelist 1', kind: text('lowerThird', '[Panelist name]', '[Title, organization]') },
          { name: 'Panelist 2', kind: text('lowerThird', '[Panelist name]', '[Title, organization]') },
          { name: 'Panelist 3', kind: text('lowerThird', '[Panelist name]', '[Title, organization]') },
          {
            name: 'Poll',
            kind: {
              type: 'poll',
              ...defaultPoll(),
              question: 'Which topic should we cover next?',
              options: ['[Topic A]', '[Topic B]', '[Topic C]'],
              votes: [0, 0, 0],
            },
          },
        ],
        quick: ['10 minutes left', '5 minutes left', 'Last question', 'Audience questions next', 'Please wrap up', 'Speak louder', 'Stand by', 'Thank you!'],
        cues: [
          ['Opening', 'Welcome and introductions'],
          ['Discussion', 'First topic'],
          ['Discussion', 'Second topic'],
          ['Discussion', 'Audience questions'],
          ['Closing', 'Thank you'],
        ],
      };
    case 'webinar':
      return {
        inputs: [
          { name: 'Starting soon', kind: countdown(3, 'Starting soon') },
          { name: 'Guest', kind: { type: 'guest', room: newRoom(), reload: 0 } },
          { name: 'Chat comments', kind: { type: 'comment', comment: null, changedAt: 0, place: 'low', accent: '#2f80ed' } },
          { name: 'Host', kind: text('lowerThird', '[Host name]', '[Title, organization]') },
          {
            name: 'Poll',
            kind: {
              type: 'poll',
              ...defaultPoll(),
              question: 'How did you hear about us?',
              options: ['[Option A]', '[Option B]', '[Option C]'],
              votes: [0, 0, 0],
            },
          },
        ],
        quick: ['Live in 1 minute', 'You are live', 'Questions in chat', 'Next: the guest', '5 minutes left', 'Please wrap up', 'Stand by', 'Thank you!'],
        cues: [
          ['Opening', 'Welcome'],
          ['Main', 'Presentation'],
          ['Main', 'Guest'],
          ['Closing', 'Questions from chat'],
          ['Closing', 'Thank you'],
        ],
        startOnLive: true,
      };
  }
}

/** The actions that set up a template in this show (inputs, messages, run of show, trigger). */
export function templateActions(id: TemplateId, show: Show, tag = Date.now().toString(36)): Action[] {
  const p = plan(id);
  const out: Action[] = [];
  const ids: string[] = [];
  p.inputs.forEach((input, i) => {
    const sid = `${id}-${tag}-${i + 1}`;
    ids.push(sid);
    const source: NewSource = { id: sid, name: input.name, kind: input.kind };
    out.push({ type: 'addSource', source });
  });
  p.quick.slice(0, 8).forEach((t, index) => out.push({ type: 'setQuickMessage', index, text: t }));
  // A run of show the operator already wrote is never replaced.
  if (show.run.cues.length === 0) {
    const cues: Cue[] = p.cues.map(([section, name], i) => ({
      id: `cue-${tag}-${i + 1}`,
      section,
      name,
      trigger: { type: 'manual' },
      lengthMs: null,
      steps: [],
    }));
    out.push({ type: 'setCues', cues });
  }
  if (p.startOnLive) {
    const cd = ids[p.inputs.findIndex((x) => x.kind.type === 'countdown')]!;
    const steps: Step[] = [
      { type: 'cutTo', screen: 'live', sourceId: cd },
      { type: 'startCountdown', sourceId: cd },
    ];
    const trigger: Trigger = {
      id: `trg-${tag}`,
      name: 'Countdown when the stream starts',
      enabled: true,
      when: { type: 'broadcast', what: 'stream', on: true },
      steps,
      lastFired: 0,
    };
    out.push({ type: 'setTriggers', triggers: [...show.triggers, trigger] });
  }
  return out;
}

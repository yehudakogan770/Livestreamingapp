// TEMPORARY visual harness (not committed).
import { createRoot } from 'react-dom/client';
import './planner.css';
import './pro.css';
import { ShowView, StageTimer } from './ShowView';
import { ListView } from './ListView';
import { Prompter } from './Prompter';
import { PlanSettings, ShortcutsDialog } from './Dialogs';
import { blankCue, blankPlan, type PlanCue } from './model';
import { OFF } from './live';
import { blankItem } from './items';
import { TEMPLATES, templateParts } from './templates';
import { watchDevice } from './device';

watchDevice();
const which = location.hash.slice(1) || 'show';
if (location.search.includes('dark')) document.documentElement.dataset.theme = 'dark';
const t = TEMPLATES[0]!;
const parts = templateParts(t, '2026-10-20');
const plan = blankPlan('p', { name: 'Annual conference, day 1', startTime: '09:00', eventDate: '2026-10-20', venue: 'Main stage', timeZone: 'America/Chicago', columns: [{ id: 'cam', name: 'Camera' }] });
const cues: PlanCue[] = parts.cues.map((c, i) => ({ ...blankCue('p', `c${i}`, (i + 1) * 1024), ...c, color: i === 2 ? 'blue' : '', script: i === 2 ? 'Good morning, everyone, and welcome to the annual conference.\n\nWe have a full day ahead.' : '' }) as PlanCue);
cues[5] = { ...cues[5]!, skip: true };
const now = Date.now();
const live = { ...OFF, planId: 'p', runId: 'r', state: 'running' as const, cueId: 'c2', cueStartedAt: now - 1500_000, showStartedAt: now - 1500_000 - 900_000, messageOn: which === 'timer', message: 'Wrap up', messageFlash: false };
const log = [
  { id: 'l0', runId: 'r', mode: 'show' as const, cueId: 'c0', cueTitle: '', plannedSec: 600, startedAt: now - 2400_000, endedAt: now - 1800_000 + 40_000, pausedSec: 0 },
  { id: 'l1', runId: 'r', mode: 'show' as const, cueId: 'c1', cueTitle: '', plannedSec: 300, startedAt: now - 1800_000 + 40_000, endedAt: now - 1500_000, pausedSec: 0 },
];
const store = { live, log, offset: 0, error: '', busy: false, ready: true, act: async () => {}, clearRun: async () => {} };
const items = parts.items.map((it, i) => blankItem('p', `i${i}`, it.kind, i, { ...it, title: it.title || ['Dana Levi', 'Sam Ortiz', 'Kim Park', 'Lee Chan', 'Ari Ross', 'Max Fox', 'Jo Hart'][i] || 'Pat', callTime: it.kind === 'crew' ? (i < 3 ? '06:30' : '08:00') : '', phone: it.kind === 'crew' ? '555-0100' : '', done: i === 8 }));
const itemStore = { items, loaded: true, error: '', ready: true, add: () => '', addMany: () => {}, edit: () => {}, tick: () => {}, remove: () => {} };
const data = { plan, cues, live, log, offset: 0 };

function H() {
  if (which === 'show') return <div style={{ height: '100vh' }}><ShowView data={data} store={store} onBack={() => {}} onTimer={() => {}} onPrompter={() => {}} /></div>;
  if (which === 'crew') return <div style={{ height: '100vh' }}><ShowView data={data} onBack={() => {}} compact /></div>;
  if (which === 'timer') return <StageTimer data={data} />;
  if (which === 'prompter') return <Prompter cues={cues} live={live} title={plan.name} />;
  if (which === 'crewlist') return <div style={{ height: '100vh', display: 'flex' }}><ListView kind="crew" store={itemStore} canEdit me="me" cues={cues} people={[]} planName="x" /></div>;
  if (which === 'tasks') return <div style={{ height: '100vh', display: 'flex' }}><ListView kind="task" store={itemStore} canEdit me="me" cues={cues} people={[]} planName="x" /></div>;
  if (which === 'settings') return <PlanSettings plan={plan} canEdit onChange={() => {}} onClose={() => {}} />;
  if (which === 'keys') return <ShortcutsDialog onClose={() => {}} />;
  return null;
}
createRoot(document.getElementById('root')!).render(<H />);

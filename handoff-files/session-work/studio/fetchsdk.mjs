import { mkdirSync, writeFileSync } from 'node:fs';
const out = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/studio/vst3sdk';
mkdirSync(out, { recursive: true });
const files = [
  'base/funknown.h',
  'base/ipluginbase.h',
  'base/ibstream.h',
  'base/ftypes.h',
  'base/fplatform.h',
  'vst/ivstcomponent.h',
  'vst/ivstaudioprocessor.h',
  'vst/ivsteditcontroller.h',
  'vst/ivsthostapplication.h',
  'vst/ivstparameterchanges.h',
  'vst/ivstmessage.h',
  'vst/vsttypes.h',
  'vst/ivstprocesscontext.h',
  'vst/ivstevents.h',
  'vst/ivstattributes.h',
  'vst/vstspeaker.h',
  'vst/vstpshpack4.h',
  'base/falignpush.h',
  'gui/iplugview.h',
];
for (const f of files) {
  const r = await fetch(`https://raw.githubusercontent.com/steinbergmedia/vst3_pluginterfaces/master/${f}`);
  const t = await r.text();
  writeFileSync(`${out}/${f.replace('/', '_')}`, t);
  console.log(f, r.status, t.length);
}

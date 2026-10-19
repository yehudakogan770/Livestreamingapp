global.document={addEventListener(){},querySelectorAll(){return []}};class DCLogic{constructor(p){this.props=p||{};this.state={}}setState(x){Object.assign(this.state,x)}}

class Component extends DCLogic {
  componentDidMount() { this.__fill(); this.__onRange = (e) => { if (e.target && e.target.type === 'range') this.__fill(); }; document.addEventListener('input', this.__onRange, true); }
  componentDidUpdate() { this.__fill(); }
  componentWillUnmount() { document.removeEventListener('input', this.__onRange, true); }
  __fill() { document.querySelectorAll('input[type=range]').forEach((el) => { const min = Number(el.min) || 0, max = el.max === '' ? 100 : Number(el.max), v = Number(el.value); el.style.setProperty('--fill', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%'); }); }
  constructor(props) { super(props); this.state = { nav: 'Features', shot: 0, dl: false, msg: '', sent: false }; }
  renderVals() {
    const st = this.state;
    const set = (o) => this.setState(o);
    const nav = ['Features', 'How it works', 'Screenshots', 'Download', 'Support'].map((name) => {
      const on = st.nav === name;
      return { name, pick: () => set({ nav: name }), style: `height: 36px; padding: 0 12px; border: 0; border-radius: 6px; background: ${on ? '#243039' : 'transparent'}; color: ${on ? '#ffffff' : '#d4d5d8'}; font-size: 14px;` };
    });
    const F = [
      ['Three screens from one app', 'Live stream, back screen and stage monitor — each shows exactly what it should.'],
      ['Presets & cues', 'Save each moment of the night as a preset and step through the run of show.'],
      ['Stage monitor messages', 'Send “5 minutes left”, a clock and a countdown to the stage, or flash to get attention.'],
      ['Phones as cameras & remotes', 'Turn a phone into a camera, or run the show from a phone or tablet browser.'],
      ['Green screen scenes', 'Key out a green background and place speakers in a scene of your choice.'],
      ['Stream everywhere + record', 'Go live on several sites at once, and every event is recorded to MP4.'],
      ['Works offline', 'Nothing depends on the internet during the event, except the stream itself.'],
      ['Panic button', 'Double-click to blank the screens instantly; the stage monitor just dims.']
    ];
    const features = F.map(([title, text], i) => ({ num: String(i + 1).padStart(2, '0'), title, text }));
    const whys = [
      ['Built for one operator', 'The important actions are big and one click away, with keyboard shortcuts for all of them.'],
      ['Set up once', 'Screens, inputs and messages are remembered, so the next event starts ready.'],
      ['Calm under pressure', 'Preview before anything goes live, and a panic button when you need it.'],
      ['Everything in one place', 'No separate apps for streaming, slides, the stage monitor and recording.']
    ].map(([title, text]) => ({ title, text }));
    const steps = [
      ['Connect your screens', 'Choose which display is the Live, Back and Monitor screen — once.'],
      ['Add inputs', 'Cameras, phones, videos, slides, images and text.'],
      ['Build presets', 'Arrange each moment of the event and put them in order.'],
      ['Go live', 'Press Go Live, then step through with Next and TAKE.']
    ].map(([title, text], i) => ({ num: String(i + 1), title, text }));
    const TABS = [['Main screen', 'Main event screen'], ['Go Live', 'Go Live popup'], ['Monitor', 'Stage monitor messages'], ['Remote', 'Phone remote']];
    const shotTabs = TABS.map(([name], i) => {
      const on = st.shot === i;
      return { name, pick: () => set({ shot: i }), style: `height: 34px; padding: 0 14px; border-radius: 6px; border: 0; background: ${on ? '#243039' : 'transparent'}; color: ${on ? '#ffffff' : '#a9abb0'}; font-size: 13px; font-weight: 600;` };
    });
    const shots = [['Presets panel', 'Build the run of show'], ['Green screen scene', 'Key and place a speaker'], ['Event end', 'Keep or delete the recording']].map(([name, sub]) => ({ name, sub }));
    const reqs = [
      ['Operating system', 'Windows 10 or Windows 11, 64-bit'],
      ['Processor', '[Minimum CPU — to be confirmed]'],
      ['Memory', '[Minimum RAM — to be confirmed]'],
      ['Graphics', '[GPU requirement — to be confirmed]'],
      ['Displays', 'Up to 3 outputs (Live, Back, Monitor)'],
      ['Internet', 'Only for streaming and updates']
    ].map(([k, v]) => ({ k, v }));
    return {
      nav, features, whys, steps, shotTabs, shots, reqs,
      shotMain: TABS[st.shot][1],
      goHow: () => set({ nav: 'How it works' }),
      download: () => set({ dl: true }),
      dlLabel: st.dl ? 'Download started…' : 'Download for Windows',
      dlStyle: `height: 52px; padding: 0 24px; border-radius: 6px; border: 0; background: ${st.dl ? '#243039' : '#4fb3bf'}; color: ${st.dl ? '#ffffff' : '#0e2a2e'}; font-size: 16px; font-weight: 600;`,
      msg: st.msg,
      onMsg: (e) => set({ msg: e.target.value, sent: false }),
      send: () => set({ sent: true, msg: '' }),
      sentText: st.sent ? 'Thank you — your message was sent to the Lumora team.' : 'Private — not published on the site.',
      sentStyle: `font-size: 13px; color: ${st.sent ? '#8fd3db' : '#8e9096'};`
    };
  }
}

const c=new Component({});c.renderVals();
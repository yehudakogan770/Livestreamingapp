import { useEffect, useState } from 'react';
import type { EngineClient, RemoteStatus } from '../engine/client';
import type { GuestWifi } from '../engine/types/GuestWifi';
import type { Act } from './act';
import { useStage } from '../engine/CountdownContext';
import { useFeature } from '../auth/accessContext';

/** The address phones join at: the internet link when it is up, else this network's. */
export function audienceAddress(remote: RemoteStatus | null): { voteUrl: string; voteQr: string; internet: boolean } | null {
  const net = remote?.internet;
  if (net?.on && net.voteUrl && net.voteQr) return { voteUrl: net.voteUrl, voteQr: net.voteQr, internet: true };
  const a = remote?.running ? remote.addresses[0] : undefined;
  return a ? { voteUrl: a.voteUrl, voteQr: a.voteQr, internet: false } : null;
}

/** The phone page's address, kept on the input so its code can show on screen. */
export function useAudienceLink(client: EngineClient, has: { joinUrl: string; joinQr: string } | null, save: (url: string, qr: string) => void) {
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  useEffect(() => client.watchRemote(setRemote), [client]);
  const address = audienceAddress(remote);
  useEffect(() => {
    if (!has || !address || (has.joinUrl === address.voteUrl && has.joinQr === address.voteQr)) return;
    save(address.voteUrl, address.voteQr);
  }, [address?.voteUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  return { remote, address };
}

const PHASE: Record<RemoteStatus['internet']['phase'], string> = {
  off: '',
  getting: 'Getting ready (the first time takes a minute)…',
  starting: 'Connecting…',
  on: 'On',
  retrying: 'Reconnecting…',
};

/** The Wi-Fi guests join by scanning a code (for halls without internet). */
function WifiSetup({ wifi, client, act }: { wifi: GuestWifi; client: EngineClient; act: Act }) {
  const [name, setName] = useState(wifi.name);
  const [password, setPassword] = useState(wifi.password);
  const save = async (show: boolean) => {
    const n = name.trim();
    const esc = (s: string) => s.replace(/([\;,:"])/g, '\\$1');
    const qr = n ? await client.qrCode(`WIFI:T:${password ? 'WPA' : 'nopass'};S:${esc(n)};P:${esc(password)};;`) : '';
    act({ type: 'updateEvent', patch: { wifi: { name: n, password, qr, show: show && !!n } } });
  };
  return (
    <details className="join__wifi">
      <summary>Code to join the Wi-Fi{wifi.show ? ' · on' : ''}</summary>
      <p className="field__note">
        For halls without internet: guests scan this first to join your Wi-Fi (a travel router or a phone's hotspot), then the page's code. The two codes take
        turns on screen.
      </p>
      <div className="join__wifirow">
        <input className="text" placeholder="Wi-Fi name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Wi-Fi name" />
        <input className="text" placeholder="Password (if any)" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Wi-Fi password" />
      </div>
      <div className="join__wifirow">
        <button type="button" className="btn btn--primary btn--small" disabled={!name.trim()} onClick={() => void save(true)}>
          {wifi.show ? 'Save' : 'Show the Wi-Fi code'}
        </button>
        {wifi.show && (
          <button type="button" className="btn btn--small" onClick={() => void save(false)}>
            Stop showing it
          </button>
        )}
      </div>
    </details>
  );
}

/** How phones reach the audience page: this Wi-Fi, the internet, a code to join the Wi-Fi. */
export function JoinSetup({ remote, what, client, act }: { remote: RemoteStatus | null; what: string; client: EngineClient; act: Act }) {
  const wifi = useStage()?.event.wifi ?? { name: '', password: '', qr: '', show: false };
  const address = audienceAddress(remote);
  const net = remote?.internet;
  // The Lumora team can turn the internet link off (Features); a link already on stays on until it is switched off.
  const internetOn = useFeature('audience_link', !!net?.on);
  return (
    <div className="join">
      {address ? (
        <p className="field__note">
          Phones {what} at <b>{address.voteUrl.replace(/^https?:\/\//, '')}</b> — no PIN needed
          {address.internet ? ', from any network (mobile data, any Wi-Fi)' : ', on the same Wi-Fi as this computer'}.
        </p>
      ) : (
        <p className="field__note field__note--warn">Phones {what} from their own browser — switch on one of these:</p>
      )}
      <div className="join__row">
        <label className="check">
          <input type="checkbox" checked={!!remote?.running} onChange={(e) => void client.setRemote(e.target.checked).catch(() => {})} /> Same Wi-Fi as this
          computer
        </label>
        {internetOn ? (
          <label className="check">
            <input type="checkbox" checked={!!net?.on} onChange={(e) => void client.setAudienceInternet(e.target.checked).catch(() => {})} /> Anyone with
            internet (needs internet on this computer)
          </label>
        ) : (
          <span className="field__note">The internet link is turned off by the Lumora team.</span>
        )}
        {net?.on && net.phase !== 'on' && <span className="join__phase">{PHASE[net.phase]}</span>}
      </div>
      {net?.error && <p className="field__note field__note--warn">Internet link: {net.error}</p>}
      <WifiSetup wifi={wifi} client={client} act={act} />
    </div>
  );
}

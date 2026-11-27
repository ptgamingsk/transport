const tokenEndpoint = 'https://ptgamingsk-transport-radio.ptgamingsk-transport-radio.workers.dev/token';
const sdkUrl = 'https://cdn.jsdelivr.net/npm/livekit-client@2.15.6/dist/livekit-client.umd.min.js';
let sdkRequest;

function loadSdk() {
  if (!sdkRequest) {
    sdkRequest = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = sdkUrl;
      script.onload = () => window.LivekitClient?.Room
        ? resolve(window.LivekitClient) : reject(new Error('sdk'));
      script.onerror = () => reject(new Error('sdk'));
      document.head.append(script);
    }).catch(error => {
      sdkRequest = undefined;
      throw error;
    });
  }
  return sdkRequest;
}

export function mountRadio(host, getUser) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.innerHTML = `
    <h2>Firemná vysielačka</h2>
    <button type="button" class="secondary" data-connect>Pripojiť vysielačku</button>
    <button type="button" class="primary" data-talk disabled>Podrž a hovor</button>
    <button type="button" class="secondary" data-enable-audio hidden>Zapnúť príjem zvuku</button>
    <p class="muted"><label>Klávesová skratka PTT: <select data-ptt-key></select></label><br>Funguje iba v aktívnom okne webovky.</p>
    <p class="muted" role="status"></p>
    <p class="muted" data-radio-activity aria-live="polite">Na kanáli nikto nevysiela.</p>
    <p class="muted" data-radio-count>Pripojení: 0</p>
    <div data-audio hidden></div>`;
  host.append(panel);

  const connect = panel.querySelector('[data-connect]');
  const talk = panel.querySelector('[data-talk]');
  const enableAudio = panel.querySelector('[data-enable-audio]');
  const status = panel.querySelector('[role=status]');
  const audio = panel.querySelector('[data-audio]');
  const activity = panel.querySelector('[data-radio-activity]');
  const count = panel.querySelector('[data-radio-count]');

  const keySelect = panel.querySelector('[data-ptt-key]');
  const keys = ['F8','F9','F10', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(k => 'Key' + k)];
  const storageKey = 'transport-radio-ptt-key';
  for (const key of keys) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key.replace(/^Key/, '');
    keySelect.append(option);
  }
  try { keySelect.value = localStorage.getItem(storageKey) || 'F9'; } catch {}
  if (!keys.includes(keySelect.value)) keySelect.value = 'F9';
  let heldKey = null;
  keySelect.onchange = () => {
    release();
    try { localStorage.setItem(storageKey, keySelect.value); } catch {}
  };
  function shortcutDown(event) {
    if (event.code !== keySelect.value || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || talk.disabled || !panel.isConnected) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    if (event.repeat || heldKey) return;
    heldKey = event.code;
    transmit(true);
  }
  function shortcutUp(event) {
    if (event.code !== heldKey) return;
    event.preventDefault();
    heldKey = null;
    transmit(false);
  }

  let context;
  function beep(frequency, duration = 0.075) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context ||= new AudioContext();
      if (context.state === 'suspended') context.resume().catch(() => {});
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration + 0.01);
    } catch { /* Zvukové upozornenie nesmie prerušiť vysielačku. */ }
  }
  function refreshActivity() {
    const active = session;
    if (!active?.room) {
      count.textContent = 'Pripojení: 0';
      activity.textContent = 'Na kanáli nikto nevysiela.';
      return;
    }
    count.textContent = 'Pripojení: ' + (active.room.remoteParticipants.size + 1);
    if (active.desiredTransmit === true) {
      activity.textContent = '🔴 VYSIELAM · ' + (active.room.localParticipant.name || 'Ja');
      return;
    }
    const speaker = [...active.room.remoteParticipants.values()].find(p =>
      [...p.audioTrackPublications.values()].some(pub => pub.source === 'microphone' && !pub.isMuted));
    activity.textContent = speaker
      ? '🟢 PRIJÍMAM · ' + (speaker.name || speaker.identity || 'Vodič')
      : 'Na kanáli nikto nevysiela.';
  }
  let session;
  let closed = false;

  function transmit(active) {
    if (!session?.track) return;
    const current = session;
    const desired = active && !talk.disabled;
    if (current.desiredTransmit === desired) return;
    current.desiredTransmit = desired;
    if (!desired) current.track.mediaStreamTrack.enabled = false;
    talk.textContent = desired ? 'Vysielaš…' : 'Podrž a hovor';
    beep(desired ? 1050 : 680);
    current.muteQueue = (current.muteQueue || Promise.resolve()).catch(() => {}).then(async () => {
      if (session !== current) return;
      if (current.desiredTransmit) await current.track.unmute();
      else await current.track.mute();
      if (session === current && !current.desiredTransmit) current.track.mediaStreamTrack.enabled = false;
      refreshActivity();
    }).catch(error => {
      if (session !== current) return;
      current.desiredTransmit = false;
      current.track.mediaStreamTrack.enabled = false;
      talk.textContent = 'Podrž a hovor';
      status.textContent = 'Signalizácia mikrofónu zlyhala.';
      console.warn('Radio mute state', error);
      refreshActivity();
    });
    refreshActivity();
  }

  function disconnect(message = '') {
    heldKey = null;
    transmit(false);
    const active = session;
    session = undefined;
    active?.abort.abort();
    active?.track?.stop();
    active?.room?.disconnect().catch(() => {});
    audio.replaceChildren();
    enableAudio.hidden = true;
    talk.disabled = true;
    connect.disabled = false;
    connect.textContent = 'Pripojiť vysielačku';
    status.textContent = message;
    refreshActivity();
  }

  enableAudio.onclick = async () => {
    const active = session;
    if (!active?.room) return;
    try {
      await active.room.startAudio();
      if (session === active) enableAudio.hidden = true;
    } catch {
      if (session === active) status.textContent = 'Prehliadač stále blokuje prehrávanie zvuku.';
    }
  };

  connect.onclick = async () => {
    if (session) {
      disconnect();
      return;
    }
    const active = session = { abort: new AbortController() };
    connect.disabled = true;
    status.textContent = 'Pripájam vysielačku…';
    let phase = 'token';
    try {
      const user = getUser();
      if (!user) throw new Error('account');
      const idToken = await user.getIdToken();
      const response = await fetch(tokenEndpoint, {
        method: 'POST', headers: { Authorization: 'Bearer ' + idToken }, signal: active.abort.signal
      });
      if (response.status === 401 || response.status === 403) throw new Error('account');
      if (!response.ok) throw new Error('service');
      const token = await response.json();
      phase = 'sdk';
      const sdk = await loadSdk();
      if (closed || session !== active) return;
      const room = active.room = new sdk.Room();

      room.on(sdk.RoomEvent.ParticipantConnected, refreshActivity);
      room.on(sdk.RoomEvent.ParticipantDisconnected, refreshActivity);
      room.on(sdk.RoomEvent.ActiveSpeakersChanged, refreshActivity);
      room.on(sdk.RoomEvent.TrackMuted, refreshActivity);
      room.on(sdk.RoomEvent.TrackUnmuted, refreshActivity);
      room.on(sdk.RoomEvent.TrackPublished, refreshActivity);
      room.on(sdk.RoomEvent.TrackUnpublished, refreshActivity);
      room.on(sdk.RoomEvent.TrackSubscribed, track => {
        if (session === active && track.kind === 'audio') audio.append(track.attach());
      });
      room.on(sdk.RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => element.remove()));
      room.on(sdk.RoomEvent.Disconnected, reason => {
        if (session !== active) return;
        active.reason = reason;
        if (!active.joined) return;
        const detail = Number.isInteger(reason) ? ' (kód ' + reason + ')' : '';
        disconnect('LiveKit ukončil spojenie' + detail + '.');
      });
      room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () => {
        if (session === active) enableAudio.hidden = room.canPlaybackAudio;
      });
      room.on(sdk.RoomEvent.Reconnecting, () => {
        if (session !== active) return;
        release();
        talk.disabled = true;
        status.textContent = 'Obnovujem spojenie…';
      });
      room.on(sdk.RoomEvent.Reconnected, () => {
        if (session !== active) return;
        talk.disabled = !active.track;
        status.textContent = 'Pripojené.';
      });
      phase = 'livekit';
      await room.connect(token.server_url, token.participant_token);
      if (closed || session !== active) return;
      if (active.reason !== undefined) throw new Error('livekit');
      enableAudio.hidden = room.canPlaybackAudio;
      phase = 'microphone';
      const track = await sdk.createLocalAudioTrack();
      track.mediaStreamTrack.enabled = false;
      if (closed || session !== active) {
        track.stop();
        return;
      }
      active.track = track;
      active.desiredTransmit = false;
      phase = 'publish';
      await room.localParticipant.publishTrack(track, { source: sdk.Track.Source.Microphone });
      if (closed || session !== active) return;
      await track.mute();
      if (closed || session !== active) return;
      if (active.reason !== undefined) throw new Error('livekit');
      active.joined = true;
      talk.disabled = false;
      connect.disabled = false;
      connect.textContent = 'Odpojiť vysielačku';
      status.textContent = 'Pripojené.';
      refreshActivity();
    } catch (error) {
      if (session !== active) return;
      const messages = {
        token: error.message === 'account' ? 'Účet nemá prístup k vysielačke.'
          : 'Server vysielačky nevydal prístupový token.',
        sdk: 'Hlasovú knižnicu sa nepodarilo načítať.',
        livekit: 'Pripojenie k LiveKit zlyhalo.',
        microphone: error.name === 'NotAllowedError' ? 'Povoľ mikrofón a skús sa pripojiť znova.'
          : 'Mikrofón sa nepodarilo otvoriť.',
        publish: 'LiveKit neprijal mikrofón do hlasového kanála.'
      };
      const reason = [error.status, error.reason, active.reason].find(Number.isInteger);
      disconnect(messages[phase] + (reason === undefined ? '' : ' Kód: ' + reason + '.'));
    }
  };

  talk.style.touchAction = 'none';
  talk.onpointerdown = event => {
    if (event.button !== 0 || talk.disabled) return;
    talk.setPointerCapture(event.pointerId);
    transmit(true);
  };
  talk.onpointerup = talk.onpointercancel = talk.onlostpointercapture = () => transmit(false);
  talk.onkeydown = event => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) transmit(true);
  };
  talk.onkeyup = event => {
    if (event.key === ' ' || event.key === 'Enter') transmit(false);
  };
  talk.onblur = () => transmit(false);
  const release = () => { heldKey = null; transmit(false); };
  window.addEventListener('keydown', shortcutDown);
  window.addEventListener('keyup', shortcutUp);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', release);
  return () => {
    closed = true;
    disconnect();
    window.removeEventListener('keydown', shortcutDown);
    window.removeEventListener('keyup', shortcutUp);
    window.removeEventListener('blur', release);
    document.removeEventListener('visibilitychange', release);
  };
}

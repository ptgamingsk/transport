import {
  collection, doc, onSnapshot, query, serverTimestamp, setDoc, where
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

import { mountRadio } from './transport-radio.js?v=diagnostics';

const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava', year: 'numeric', month: 'numeric', day: 'numeric' });
const dayMs = 86_400_000;
const statusInfo = {
  fault: ['Porucha vozidla', '#ff8585'],
  leave: ['Dovolenka', '#d8adff'],
  break: ['Prestávka', '#ffdc78'],
  route: ['Na trase', '#8dcaff'],
  online: ['Online', '#a4ec48'],
  offline: ['Offline', '#b5c0bd']
};

function slovakDay(now) {
  const parts = Object.fromEntries(day.formatToParts(now).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day) / dayMs;
}

function fresh(record, now, key = 'updated', maxAge = 150_000) {
  const stamp = record?.[key]?.toMillis?.();
  return Number.isFinite(stamp) && now - stamp >= -5_000 && now - stamp <= maxAge;
}

export function driverStatus(uid, account, data, now) {
  if (!account.enabled) return 'offline';
  const today = slovakDay(now);
  if (data.faults.get(uid)?.active) return 'fault';
  if ([...data.leaves.values()].some(leave =>
    leave.uid === uid && leave.fromDay <= today && today <= leave.toDay
  )) return 'leave';

  const telemetry = data.telemetry.get(uid);
  const drivingEts = telemetry?.connected === true && fresh(telemetry, now)
    && (account.jobs || []).some(job => job.sim === 'ETS2');
  const online = fresh(data.presence.get(uid), now, 'at');
  if ((online || drivingEts) && [...data.breaks.values()].some(shift => shift.uid === uid)) return 'break';
  if (drivingEts || (online && [...data.runs.values()].some(run => run.uid === uid))) return 'route';
  return online ? 'online' : 'offline';
}

export function createLiveDispatch(db, now, getUser) {
  if (db.app.options.projectId !== 'ptgamingsk-transport') throw new Error('Nesprávny projekt dispečingu.');
  let session;

  function close() {
    session?.cleanup.forEach(stop => stop());
    session = undefined;
  }

  function show(host, uid, director) {
    if (session?.uid === uid && session.panel.parentNode === host) return;
    close();
    const panel = document.createElement('section');
    panel.className = 'panel live-dispatch';
    panel.innerHTML = '<h1>Živý dispečing</h1><p class="muted" role="status">Načítavam stavy…</p><div data-dispatch-rows></div>';
    host.replaceChildren(panel);
    const state = session = { uid, panel, cleanup: [] };
    const status = panel.querySelector('[role=status]');
    const rows = panel.querySelector('[data-dispatch-rows]');

    state.cleanup.push(mountRadio(panel, getUser));

    if (!director) {
      const ref = doc(db, 'transportDispatchFaults', uid);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary';
      button.disabled = true;
      rows.append(button);
      let active = false;
      let connected = false;
      let sending = false;
      state.cleanup.push(onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
        if (session !== state) return;
        connected = !snapshot.metadata.fromCache;
        active = snapshot.data()?.active === true;
        button.textContent = active ? 'Ukončiť stav poruchy' : 'Označiť poruchu vozidla';
        button.disabled = !connected || sending;
        status.textContent = connected
          ? (active ? 'Dispečing vidí stav Porucha vozidla.' : 'Stav poruchy nie je aktívny.')
          : 'Čakám na pripojenie…';
      }, () => {
        connected = false;
        button.disabled = true;
        status.textContent = 'Stav poruchy nie je dostupný. Skontroluj pravidlá Firestore.';
      }));
      button.onclick = async () => {
        if (session !== state || !connected || sending) return;
        sending = true;
        button.disabled = true;
        try {
          await setDoc(ref, { active: !active, updated: serverTimestamp() });
        } catch {
          status.textContent = 'Zmenu stavu sa nepodarilo uložiť.';
        } finally {
          sending = false;
          button.disabled = !connected;
        }
      };
      return;
    }

    const filter = (path, key, value) => query(collection(db, path), where(key, '==', value));
    const sources = {
      accounts: collection(db, 'driverAccounts'),
      presence: collection(db, 'clockSync'),
      faults: filter('transportDispatchFaults', 'active', true),
      leaves: filter('transportLeaveRequests', 'status', 'approved'),
      breaks: filter('shiftAttendance', 'phase', 'break'),
      runs: filter('busRuns', 'phase', 'running'),
      telemetry: collection(db, 'driverTelemetry')
    };
    const data = {};
    const failures = new Set();
    function draw() {
      if (session !== state) return;
      if (failures.size) {
        rows.replaceChildren();
        status.textContent = 'Niektoré zdroje dispečingu sú nedostupné. Skús znova otvoriť sekciu.';
        return;
      }
      if (Object.keys(data).length < Object.keys(sources).length) {
        rows.replaceChildren();
        status.textContent = 'Čakám na aktuálne údaje…';
        return;
      }
      const current = now();
      const accounts = [...data.accounts].sort(([, a], [, b]) => a.name.localeCompare(b.name, 'sk'));
      status.textContent = accounts.length ? '' : 'Zatiaľ žiadne účty vodičov.';
      rows.replaceChildren(...accounts.map(([driverUid, account]) => {
        const row = document.createElement('article');
        const name = document.createElement('strong');
        const badge = document.createElement('span');
        const [label, color] = statusInfo[driverStatus(driverUid, account, data, current)];
        name.textContent = account.name;
        badge.className = 'pill';
        badge.style.color = color;
        badge.style.borderColor = color;
        badge.textContent = label;
        row.append(name, badge);
        return row;
      }));
    }
    for (const [key, source] of Object.entries(sources)) {
      state.cleanup.push(onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache) delete data[key];
        else data[key] = new Map(snapshot.docs.map(item => [item.id, item.data()]));
        draw();
      }, () => {
        failures.add(key);
        draw();
      }));
    }
    const interval = setInterval(draw, 5_000);
    state.cleanup.push(() => clearInterval(interval));
  }

  return { show, close };
}

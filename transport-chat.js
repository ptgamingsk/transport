import {
  addDoc, collection, deleteDoc, doc, getDocsFromServer, limit, onSnapshot,
  orderBy, query, serverTimestamp, startAfter
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const pageSize = 40;
const dateFormat = new Intl.DateTimeFormat('sk-SK', {
  timeZone: 'Europe/Bratislava', dateStyle: 'short', timeStyle: 'short'
});

export function createTransportChat({ db, notify, isVisible, onUnreadChange }) {
  if (db.app.options.projectId !== 'ptgamingsk-transport') {
    throw new Error('Nesprávny Firebase projekt pre interný chat.');
  }

  const messages = collection(db, 'transportInternalChat');
  const ordered = query(messages, orderBy('sentAt', 'desc'));
  let session;

  function markRead() {
    if (!session?.unread.size || !isVisible()) return;
    session.revealUnread();
    session.unread.clear();
    onUnreadChange();
  }

  document.addEventListener('visibilitychange', markRead);

  function stop() {
    session?.unsubscribe?.();
    session = undefined;
  }

  function start(uid, senderName, director = false) {
    if (session?.uid === uid) {
      session.senderName = senderName;
      return;
    }
    stop();

    const panel = document.createElement('section');
    panel.className = 'panel transport-chat';
    panel.innerHTML = `
      <h1>Interný chat</h1>
      <button type="button" class="secondary" data-older hidden>Načítať staršie správy</button>
      <ol aria-label="História správ"></ol>
      <form>
        <label for="transportChatMessage">Správa</label>
        <textarea id="transportChatMessage" required maxlength="1000" rows="1" placeholder="Napíš správu…"></textarea>
        <button class="primary" disabled>Odoslať</button>
      </form>
      <p class="muted" role="status">Pripájam chat…</p>`;

    const state = session = {
      uid, senderName, panel, live: [], history: new Map(), cursor: null, hasMore: false,
      loaded: false, connected: false, unread: new Set()
    };
    const list = panel.querySelector('ol');
    const status = panel.querySelector('[role=status]');
    const form = panel.querySelector('form');
    const input = form.querySelector('textarea');
    const send = form.querySelector('button');
    const older = panel.querySelector('[data-older]');

    state.revealUnread = () => {
      state.firstUnread = [...list.children].find(item => state.unread.has(item.dataset.messageId))?.dataset.messageId;
      draw('unread');
    };

    function draw(scrollTo) {
      const oldHeight = list.scrollHeight;
      const oldTop = list.scrollTop;
      const nearBottom = oldHeight - oldTop - list.clientHeight < 48;
      const rows = [...state.history.values(), ...state.live].sort((a, b) =>
        a.data().sentAt.toMillis() - b.data().sentAt.toMillis() || a.id.localeCompare(b.id)
      );
      const items = rows.flatMap(row => {
        const message = row.data();
        const item = document.createElement('li');
        item.className = message.uid === uid ? 'chat-bubble chat-bubble-own' : 'chat-bubble';
        item.dataset.messageId = row.id;
        const meta = document.createElement('div');
        meta.className = 'chat-message-meta';
        const by = document.createElement('strong');
        const time = document.createElement('time');
        const text = document.createElement('p');
        const date = message.sentAt.toDate();
        by.textContent = message.senderName;
        time.dateTime = date.toISOString();
        time.textContent = dateFormat.format(date);
        text.textContent = message.text;
        meta.append(by, time);
        item.append(meta, text);
        if (director) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'secondary danger';
          remove.textContent = 'Odstrániť správu';
          remove.onclick = async () => {
            if (session !== state || !confirm('Trvalo odstrániť túto správu?')) return;
            remove.disabled = true;
            try {
              await deleteDoc(doc(messages, row.id));
              state.history.delete(row.id);
              state.live = state.live.filter(entry => entry.id !== row.id);
              draw();
              status.textContent = 'Správa bola odstránená.';
            } catch {
              status.textContent = 'Správu sa nepodarilo odstrániť.';
              remove.disabled = false;
            }
          };
          item.append(remove);
        }
        if (row.id !== state.firstUnread) return [item];
        const divider = document.createElement('li');
        divider.className = 'chat-new-messages';
        divider.textContent = 'Nové správy';
        return [divider, item];
      });
      list.replaceChildren(...items);
      if (scrollTo === 'unread') {
        const divider = list.querySelector('.chat-new-messages');
        list.scrollTop = divider ? divider.offsetTop : list.scrollHeight;
      } else if (scrollTo === 'history') {
        list.scrollTop = oldTop + list.scrollHeight - oldHeight;
      } else if (nearBottom) {
        list.scrollTop = list.scrollHeight;
      }
      older.hidden = !state.hasMore;
    }

    older.onclick = async () => {
      if (!state.cursor || session !== state) return;
      older.disabled = true;
      try {
        const snapshot = await getDocsFromServer(query(ordered, startAfter(state.cursor), limit(pageSize)));
        if (session !== state) return;
        const liveIds = new Set(state.live.map(row => row.id));
        for (const row of snapshot.docs) {
          if (!liveIds.has(row.id)) state.history.set(row.id, row);
        }
        state.cursor = snapshot.docs.at(-1) || state.cursor;
        state.hasMore = snapshot.size === pageSize;
        draw('history');
      } catch {
        status.textContent = 'Staršie správy sa nepodarilo načítať.';
      } finally {
        older.disabled = false;
      }
    };

    form.onsubmit = async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (session !== state || !state.connected || send.disabled || !text) return;
      send.disabled = true;
      input.readOnly = true;
      status.textContent = 'Odosielam správu…';
      try {
        await addDoc(messages, { uid, senderName: state.senderName, text, sentAt: serverTimestamp() });
        input.value = '';
        status.textContent = 'Správa bola odoslaná.';
      } catch {
        status.textContent = 'Správu sa nepodarilo odoslať.';
      } finally {
        input.readOnly = false;
        send.disabled = !state.connected;
      }
    };

    state.unsubscribe = onSnapshot(query(ordered, limit(pageSize)), { includeMetadataChanges: true }, snapshot => {
      if (session !== state) return;
      state.connected = !snapshot.metadata.fromCache;
      send.disabled = !state.connected || input.readOnly;
      if (!state.connected) {
        state.history.clear();
        state.live = [];
        state.loaded = false;
        state.hasMore = false;
        draw();
        status.textContent = 'Čakám na pripojenie k chatu…';
        return;
      }
      const live = snapshot.docs.filter(row => !row.metadata.hasPendingWrites && row.data().sentAt);
      const previous = new Set(state.live.map(row => row.id));
      const previousUnread = state.unread.size;
      if (state.loaded && !isVisible()) {
        const newest = state.live[0]?.data().sentAt;
        for (const row of live.filter(row => !previous.has(row.id)).reverse()) {
          const message = row.data();
          if (message.uid !== uid && (!newest || message.sentAt.toMillis() >= newest.toMillis())) {
            state.unread.add(row.id);
            notify('chat:' + row.id, 'Nová správa v internom chate', message.senderName + ' · ' + message.text.slice(0, 120));
          }
        }
      }
      if (!state.loaded || state.live.at(-1)?.id !== live.at(-1)?.id) {
        state.history.clear();
        state.cursor = live.at(-1);
        state.hasMore = live.length === pageSize;
      }
      state.live = live;
      state.loaded = true;
      if (state.unread.size !== previousUnread) onUnreadChange();
      draw();
      if (!input.readOnly) status.textContent = live.length ? 'Chat je pripojený.' : 'Zatiaľ žiadne správy.';
    }, () => {
      if (session !== state) return;
      state.connected = false;
      send.disabled = true;
      older.hidden = true;
      list.replaceChildren();
      status.textContent = 'Chat nie je dostupný. Znova sa prihlás alebo kontaktuj riaditeľa.';
    });
  }

  return {
    start, stop,
    unreadCount: () => session?.unread.size ?? 0,
    show(host) {
      if (!session) return;
      if (session.panel.parentNode !== host) {
        host.replaceChildren(session.panel);
        const list = session.panel.querySelector('ol');
        list.scrollTop = list.scrollHeight;
      }
      markRead();
    }
  };
}

import {
  addDoc, collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const dayMs = 86_400_000;
const dateFormat = new Intl.DateTimeFormat('sk-SK', { timeZone: 'UTC', dateStyle: 'medium' });
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit'
});
const labels = { pending: 'Čaká na rozhodnutie', approved: 'Schválená', rejected: 'Zamietnutá' };

export function createTransportLeave(db, now = Date.now) {
  if (db.app.options.projectId !== 'ptgamingsk-transport') {
    throw new Error('Nesprávny Firebase projekt pre dovolenky.');
  }
  const requests = collection(db, 'transportLeaveRequests');
  let session;

  function close() {
    session?.unsubscribe();
    session = undefined;
  }

  function show(host, uid, name, director = false) {
    if (session?.uid === uid && session.panel.parentNode === host) {
      session.name = name;
      return;
    }
    close();
    const panel = document.createElement('section');
    panel.className = 'panel transport-leave';
    panel.innerHTML = `
      <h1>Dovolenky</h1>
      ${director ? '' : `<form>
        <label>Od<input type="date" name="from" required></label>
        <label>Do<input type="date" name="to" required></label>
        <label>Poznámka <span class="muted">(nepovinná)</span><input name="note" maxlength="400"></label>
        <button class="primary" disabled>Odoslať žiadosť</button>
      </form>`}
      <p class="muted" role="status">Načítavam žiadosti…</p>
      <div data-requests></div>`;
    host.replaceChildren(panel);

    const state = session = { uid, name, panel, unsubscribe: () => {}, connected: false };
    const list = panel.querySelector('[data-requests]');
    const status = panel.querySelector('[role=status]');
    const form = panel.querySelector('form');
    const submit = form?.querySelector('button');

    async function decide(id, decision, actions) {
      if (session !== state || !state.connected) return;
      actions.inert = true;
      try {
        const ref = doc(requests, id);
        await runTransaction(db, async tx => {
          const request = await tx.get(ref);
          if (request.data()?.status !== 'pending') throw new Error('already-reviewed');
          tx.update(ref, { status: decision, reviewedAt: serverTimestamp() });
        });
        status.textContent = decision === 'approved' ? 'Dovolenka schválená.' : 'Dovolenka zamietnutá.';
      } catch (error) {
        status.textContent = error.message === 'already-reviewed'
          ? 'Táto žiadosť už bola vybavená.' : 'Rozhodnutie sa nepodarilo uložiť.';
      } finally {
        actions.inert = false;
      }
    }

    function card(snapshot) {
      const request = snapshot.data();
      const entry = document.createElement('article');
      const heading = document.createElement('strong');
      const details = document.createElement('p');
      heading.textContent = director ? request.name : labels[request.status];
      details.textContent = dateFormat.format(request.fromDay * dayMs) + ' – '
        + dateFormat.format(request.toDay * dayMs) + (director ? ' · ' + labels[request.status] : '');
      entry.append(heading, details);
      if (request.note) {
        const note = document.createElement('p');
        note.textContent = request.note;
        entry.append(note);
      }
      if (director && request.status === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'leave-actions';
        for (const [decision, label, style] of [
          ['approved', 'Schváliť', 'primary'], ['rejected', 'Zamietnuť', 'secondary danger']
        ]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = style;
          button.textContent = label;
          button.onclick = () => decide(snapshot.id, decision, actions);
          actions.append(button);
        }
        entry.append(actions);
      }
      return entry;
    }

    if (form) {
      const from = form.elements.from;
      const to = form.elements.to;
      function updateDates() {
        from.min = localDate.format(new Date(now()));
        to.min = from.value > from.min ? from.value : from.min;
      }
      updateDates();
      from.value = from.min;
      form.addEventListener('focusin', updateDates);
      from.onchange = updateDates;
      form.onsubmit = async event => {
        event.preventDefault();
        updateDates();
        if (session !== state || !state.connected || submit.disabled || !form.reportValidity()) return;
        submit.disabled = true;
        state.sending = true;
        try {
          await addDoc(requests, {
            uid, name: state.name, fromDay: from.valueAsNumber / dayMs, toDay: to.valueAsNumber / dayMs,
            note: form.elements.note.value.trim(), status: 'pending', createdAt: serverTimestamp()
          });
          form.reset();
          updateDates();
          from.value = from.min;
          status.textContent = 'Žiadosť bola odoslaná.';
        } catch {
          status.textContent = 'Žiadosť sa nepodarilo odoslať.';
        } finally {
          state.sending = false;
          submit.disabled = !state.connected;
        }
      };
    }

    const source = director ? requests : query(requests, where('uid', '==', uid));
    state.unsubscribe = onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
      if (session !== state) return;
      state.connected = !snapshot.metadata.fromCache;
      if (submit) submit.disabled = !state.connected || state.sending === true;
      if (!state.connected) {
        list.replaceChildren();
        status.textContent = 'Čakám na pripojenie…';
        return;
      }
      const rows = snapshot.docs.filter(row => row.data().createdAt).sort((a, b) => {
        const first = a.data();
        const second = b.data();
        return Number(second.status === 'pending') - Number(first.status === 'pending')
          || second.createdAt.toMillis() - first.createdAt.toMillis();
      });
      list.replaceChildren(...rows.map(card));
      if (status.textContent.startsWith('Načítavam') || status.textContent.startsWith('Čakám') || !rows.length) {
        status.textContent = rows.length ? '' : 'Zatiaľ žiadne žiadosti.';
      } else if (status.textContent === 'Zatiaľ žiadne žiadosti.') {
        status.textContent = '';
      }
    }, () => {
      if (session !== state) return;
      state.connected = false;
      if (submit) submit.disabled = true;
      list.replaceChildren();
      status.textContent = 'Dovolenky nie sú dostupné. Skontroluj prístup a pravidlá Firestore.';
    });
  }

  return { show, close };
}

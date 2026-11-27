/* The Study Room: Flashcards
   Decks and progress are saved in this browser's localStorage. */
(() => {
  'use strict';

  const STORAGE_KEY = 'studyroom.flashcards.v1';
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const $ = (id) => document.getElementById(id);

  /* ---------- Data ---------- */
  function sampleDeck() {
    const cards = [
      ['Active recall', 'Testing yourself by pulling information out of memory instead of re-reading it. One of the most effective study methods there is.'],
      ['Spaced repetition', 'Reviewing material at increasing intervals over time so it moves into long-term memory.'],
      ['Interleaving', 'Mixing different topics or problem types in one session instead of studying one topic at a time.'],
      ['The forgetting curve', 'How quickly new information fades unless you review it. First described by Hermann Ebbinghaus.'],
      ['Elaboration', 'Explaining new ideas in your own words and connecting them to what you already know.'],
      ['Dual coding', 'Pairing words with visuals (diagrams, timelines, charts) so you have two ways to remember the same idea.'],
    ];
    return {
      id: uid(),
      name: 'Sample: How to study',
      cards: cards.map(([front, back]) => ({ id: uid(), front, back, known: false })),
    };
  }

  function emptyDeck(name) {
    return { id: uid(), name, cards: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.decks) && data.decks.length) return data;
      }
    } catch (e) { /* storage unavailable or corrupt: fall through */ }
    const deck = sampleDeck();
    return { decks: [deck], currentDeckId: deck.id };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* storage unavailable: changes last until the page closes */ }
  }

  const state = load();
  const deck = () => state.decks.find((d) => d.id === state.currentDeckId) || state.decks[0];
  const findCard = (id) => deck().cards.find((c) => c.id === id);

  /* ---------- Study session ---------- */
  const session = { order: [], index: 0, flipped: false, onlyLearning: false };
  let editingId = null;

  const eligible = (c) => !session.onlyLearning || !c.known;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildSession(doShuffle = false) {
    session.order = deck().cards.filter(eligible).map((c) => c.id);
    if (doShuffle) shuffle(session.order);
    session.index = 0;
    setFlipped(false, true);
    render();
  }

  // Keep the current round after cards are added or removed.
  function syncSession() {
    const ids = new Set(deck().cards.map((c) => c.id));
    session.order = session.order.filter((id) => ids.has(id));
    const inOrder = new Set(session.order);
    deck().cards.forEach((c) => { if (!inOrder.has(c.id) && eligible(c)) session.order.push(c.id); });
    session.index = Math.min(session.index, session.order.length);
  }

  /* ---------- Elements ---------- */
  const el = {
    deckSelect: $('deck-select'),
    statTotal: $('stat-total'), statKnown: $('stat-known'), statLearning: $('stat-learning'),
    progress: $('progress'), progressBar: $('progress-bar'),
    cardArea: $('card-area'), counter: $('card-counter'), status: $('card-status'),
    card: $('flashcard'), front: $('card-front'), back: $('card-back'),
    faceFront: $('face-front'), faceBack: $('face-back'),
    prev: $('prev-btn'), next: $('next-btn'), learningBtn: $('learning-btn'), knownBtn: $('known-btn'),
    message: $('study-message'), messageTitle: $('message-title'), messageText: $('message-text'), messageActions: $('message-actions'),
    shuffle: $('shuffle-btn'), restart: $('restart-btn'), onlyLearning: $('only-learning'), resetProgress: $('reset-progress-btn'),
    form: $('card-form'), formTitle: $('form-title'), frontInput: $('front-input'), backInput: $('back-input'),
    formSubmit: $('form-submit'), formCancel: $('form-cancel'),
    bulkInput: $('bulk-input'), bulkBtn: $('bulk-btn'), bulkResult: $('bulk-result'),
    renameForm: $('rename-form'), renameInput: $('rename-input'),
    newDeckForm: $('new-deck-form'), newDeckInput: $('new-deck-input'), deleteDeck: $('delete-deck-btn'),
    list: $('card-list'), listTitle: $('list-title'), listEmpty: $('list-empty'),
  };

  /* ---------- Flip ---------- */
  function setFlipped(value, instant = false) {
    session.flipped = value;
    if (instant) el.card.classList.add('no-anim');
    el.card.classList.toggle('is-flipped', value);
    el.card.setAttribute('aria-label', value ? 'Show question' : 'Show answer');
    el.faceFront.setAttribute('aria-hidden', String(value));
    el.faceBack.setAttribute('aria-hidden', String(!value));
    if (instant) {
      void el.card.offsetWidth; // apply the change before re-enabling the animation
      el.card.classList.remove('no-anim');
    }
  }

  /* ---------- Rendering ---------- */
  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  function render() {
    renderDecks();
    renderStudy();
    renderList();
  }

  function renderDecks() {
    el.deckSelect.replaceChildren(...state.decks.map((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name} (${d.cards.length})`;
      return opt;
    }));
    el.deckSelect.value = deck().id;
    el.renameInput.value = deck().name;
  }

  function showMessage(title, text, actions) {
    el.cardArea.hidden = true;
    el.message.hidden = false;
    el.messageTitle.textContent = title;
    el.messageText.textContent = text;
    el.messageActions.replaceChildren(...actions.map(([label, fn, primary]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${primary ? 'btn-primary' : 'btn-ghost'}`;
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    }));
  }

  function renderStudy() {
    const cards = deck().cards;
    const known = cards.filter((c) => c.known).length;
    const learning = cards.length - known;

    el.statTotal.textContent = plural(cards.length, 'card');
    el.statKnown.textContent = `${known} known`;
    el.statLearning.textContent = `${learning} still learning`;

    const total = session.order.length;
    const pct = total ? Math.round((session.index / total) * 100) : 0;
    el.progressBar.style.width = `${pct}%`;
    el.progress.setAttribute('aria-valuenow', String(pct));

    const toolbarDisabled = cards.length === 0;
    [el.shuffle, el.restart, el.onlyLearning, el.resetProgress].forEach((b) => { b.disabled = toolbarDisabled; });

    if (cards.length === 0) {
      showMessage('This deck is empty', 'Add a few cards below, or paste in a whole list with bulk import.', [
        ['Add a card', () => { el.frontInput.focus(); el.form.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, true],
      ]);
      return;
    }

    if (total === 0) {
      showMessage('You know every card 🎉', 'Nothing left in "still learning." Review the whole deck to keep it fresh.', [
        ['Review all cards', () => { el.onlyLearning.checked = false; session.onlyLearning = false; buildSession(true); }, true],
      ]);
      return;
    }

    if (session.index >= total) {
      const roundKnown = session.order.filter((id) => findCard(id)?.known).length;
      const actions = [];
      if (learning > 0) {
        actions.push([`Review the ${learning} I'm still learning`, () => {
          el.onlyLearning.checked = true; session.onlyLearning = true; buildSession(true);
        }, true]);
      }
      actions.push(['Start over', () => buildSession(false), learning === 0]);
      showMessage('Round complete',
        `You marked ${roundKnown} of ${plural(total, 'card')} as known.` +
        (learning ? ' Go again on the tricky ones while they\'re fresh.' : ' Great work!'),
        actions);
      return;
    }

    el.message.hidden = true;
    el.cardArea.hidden = false;

    const card = findCard(session.order[session.index]);
    el.counter.textContent = `Card ${session.index + 1} of ${total}`;
    el.status.textContent = card.known ? 'Known' : 'Still learning';
    el.status.classList.toggle('is-known', card.known);
    el.front.textContent = card.front;
    el.back.textContent = card.back;
    el.prev.disabled = session.index === 0;
  }

  function renderList() {
    const cards = deck().cards;
    el.listTitle.textContent = `Cards in this deck (${cards.length})`;
    el.listEmpty.hidden = cards.length > 0;

    el.list.replaceChildren(...cards.map((c) => {
      const li = document.createElement('li');
      if (c.id === editingId) li.classList.add('is-editing');

      const text = document.createElement('div');
      text.className = 'item-text';
      const front = document.createElement('p');
      front.className = 'item-front';
      front.textContent = c.front;
      const back = document.createElement('p');
      back.className = 'item-back';
      back.textContent = c.back;
      const status = document.createElement('span');
      status.className = `badge item-status${c.known ? ' is-known' : ''}`;
      status.textContent = c.known ? 'Known' : 'Still learning';
      text.append(front, back, status);

      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit card: ${c.front}`);
      edit.addEventListener('click', () => startEdit(c.id));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'item-delete';
      del.textContent = 'Delete';
      del.setAttribute('aria-label', `Delete card: ${c.front}`);
      del.addEventListener('click', () => deleteCard(c.id));
      actions.append(edit, del);

      li.append(text, actions);
      return li;
    }));
  }

  /* ---------- Study actions ---------- */
  function go(delta) {
    const next = session.index + delta;
    if (next < 0 || next > session.order.length) return;
    session.index = next;
    setFlipped(false, true);
    renderStudy();
  }

  function mark(known) {
    if (el.cardArea.hidden) return;
    const card = findCard(session.order[session.index]);
    if (!card) return;
    card.known = known;
    save();
    go(1);
    renderList();
    renderDecks();
  }

  el.card.addEventListener('click', () => setFlipped(!session.flipped));
  el.prev.addEventListener('click', () => go(-1));
  el.next.addEventListener('click', () => go(1));
  el.learningBtn.addEventListener('click', () => mark(false));
  el.knownBtn.addEventListener('click', () => mark(true));
  el.shuffle.addEventListener('click', () => buildSession(true));
  el.restart.addEventListener('click', () => buildSession(false));
  el.onlyLearning.addEventListener('change', () => {
    session.onlyLearning = el.onlyLearning.checked;
    buildSession(false);
  });
  el.resetProgress.addEventListener('click', () => {
    if (!confirm(`Mark every card in "${deck().name}" as still learning?`)) return;
    deck().cards.forEach((c) => { c.known = false; });
    save();
    buildSession(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (el.cardArea.hidden) return;
    switch (e.key) {
      case ' ':
      case 'Enter':
        if (e.target.closest('button, a, summary')) return; // focused controls (including the card) handle these natively
        e.preventDefault();
        setFlipped(!session.flipped);
        break;
      case 'ArrowRight': e.preventDefault(); go(1); break;
      case 'ArrowLeft': e.preventDefault(); go(-1); break;
      case '1': mark(false); break;
      case '2': mark(true); break;
    }
  });

  /* ---------- Card editing ---------- */
  function resetForm() {
    editingId = null;
    el.form.reset();
    el.formTitle.textContent = 'Add a card';
    el.formSubmit.textContent = 'Add card';
    el.formCancel.hidden = true;
  }

  function startEdit(id) {
    const c = findCard(id);
    if (!c) return;
    editingId = id;
    el.frontInput.value = c.front;
    el.backInput.value = c.back;
    el.formTitle.textContent = 'Edit card';
    el.formSubmit.textContent = 'Save changes';
    el.formCancel.hidden = false;
    renderList();
    el.form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.frontInput.focus({ preventScroll: true });
  }

  function deleteCard(id) {
    const c = findCard(id);
    if (!c || !confirm(`Delete this card?\n\n${c.front}`)) return;
    deck().cards = deck().cards.filter((x) => x.id !== id);
    if (editingId === id) resetForm();
    save();
    syncSession();
    render();
  }

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const front = el.frontInput.value.trim();
    const back = el.backInput.value.trim();
    if (!front || !back) return;

    const editing = editingId && findCard(editingId);
    if (editing) {
      editing.front = front;
      editing.back = back;
    } else {
      deck().cards.push({ id: uid(), front, back, known: false });
    }
    resetForm();
    save();
    syncSession();
    render();
    el.frontInput.focus();
  });

  el.formCancel.addEventListener('click', () => { resetForm(); renderList(); });

  // Ctrl/Cmd + Enter submits from either textarea.
  [el.frontInput, el.backInput].forEach((t) => t.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); el.form.requestSubmit(); }
  }));

  /* ---------- Bulk import ---------- */
  el.bulkBtn.addEventListener('click', () => {
    const lines = el.bulkInput.value.split('\n').map((l) => l.trim()).filter(Boolean);
    let added = 0;
    let skipped = 0;
    lines.forEach((line) => {
      const match = line.match(/\t| [-–—] /);
      if (!match) { skipped++; return; }
      const front = line.slice(0, match.index).trim();
      const back = line.slice(match.index + match[0].length).trim();
      if (!front || !back) { skipped++; return; }
      deck().cards.push({ id: uid(), front, back, known: false });
      added++;
    });
    if (added) {
      save();
      syncSession();
      render();
      el.bulkInput.value = '';
    }
    el.bulkResult.textContent = `Added ${plural(added, 'card')}` +
      (skipped ? `, skipped ${skipped} line${skipped === 1 ? '' : 's'} with no separator.` : '.');
  });

  /* ---------- Decks ---------- */
  function switchDeck(id) {
    state.currentDeckId = id;
    save();
    resetForm();
    el.bulkResult.textContent = '';
    buildSession(false);
  }

  el.deckSelect.addEventListener('change', () => switchDeck(el.deckSelect.value));

  el.renameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.renameInput.value.trim();
    if (!name) return;
    deck().name = name;
    save();
    renderDecks();
  });

  el.newDeckForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.newDeckInput.value.trim();
    if (!name) return;
    const d = emptyDeck(name);
    state.decks.push(d);
    el.newDeckInput.value = '';
    switchDeck(d.id);
    el.frontInput.focus();
  });

  el.deleteDeck.addEventListener('click', () => {
    const d = deck();
    if (!confirm(`Delete the deck "${d.name}" and all ${plural(d.cards.length, 'card')} in it? This can't be undone.`)) return;
    state.decks = state.decks.filter((x) => x.id !== d.id);
    if (!state.decks.length) state.decks.push(emptyDeck('My deck'));
    switchDeck(state.decks[0].id);
  });

  /* ---------- Start ---------- */
  save(); // persist the starter deck so other pages (like Quizzes) can see it
  buildSession(false);
})();

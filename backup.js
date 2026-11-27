/* The Study Room: Backup & Restore
   A backup is every localStorage entry whose key starts with "studyroom.",
   so new pages (summaries, tests, podcast) are included automatically. */
(() => {
  'use strict';

  const PREFIX = 'studyroom.';
  const META_KEY = 'studyroom.backup.meta';   // last backup date, reminder snooze
  const UNDO_KEY = 'studyroom.backup.undo';   // snapshot taken before a restore
  const SKIP = new Set([META_KEY, UNDO_KEY]);
  const FLASHCARDS = 'studyroom.flashcards.v1';
  const QUIZZES = 'studyroom.quizzes.v1';
  const SUMMARIES = 'studyroom.summaries.v1';
  const STALE_DAYS = 7;

  const $ = (id) => document.getElementById(id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* ---------- Storage helpers ---------- */
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function snapshot() {
    const data = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PREFIX) && !SKIP.has(key)) {
          const value = readJSON(key);
          if (value != null) data[key] = value;
        }
      }
    } catch (e) { /* storage unavailable */ }
    return data;
  }

  function applySnapshot(data) {
    Object.keys(snapshot()).forEach((key) => localStorage.removeItem(key));
    Object.entries(data).forEach(([key, value]) => writeJSON(key, value));
  }

  const meta = () => readJSON(META_KEY) || {};
  function setMeta(patch) {
    try { writeJSON(META_KEY, { ...meta(), ...patch }); } catch (e) { /* unavailable */ }
  }

  /* ---------- Summaries ---------- */
  function summarize(data) {
    const fc = data[FLASHCARDS];
    const qz = data[QUIZZES];
    const decks = fc && Array.isArray(fc.decks) ? fc.decks : [];
    const quizzes = qz && Array.isArray(qz.quizzes) ? qz.quizzes : [];
    const attempts = qz && qz.history ? Object.values(qz.history).reduce((n, h) => n + (h.attempts || 0), 0) : 0;
    const summaries = data[SUMMARIES] && Array.isArray(data[SUMMARIES].summaries) ? data[SUMMARIES].summaries : [];
    const other = Object.keys(data).filter((k) => k !== FLASHCARDS && k !== QUIZZES && k !== SUMMARIES).length;
    const stats = [
      [decks.length, 'deck'],
      [decks.reduce((n, d) => n + (d.cards || []).length, 0), 'flashcard'],
      [quizzes.length, 'quiz'],
      [quizzes.reduce((n, q) => n + (q.questions || []).length, 0), 'question'],
      [attempts, 'quiz attempt'],
      [summaries.length, 'summary'],
    ];
    if (other) stats.push([other, 'other section']);
    return stats;
  }

  function renderStats(list, data) {
    list.replaceChildren(...summarize(data).map(([n, word]) => {
      const li = document.createElement('li');
      const num = document.createElement('span');
      num.className = 'stat-num';
      num.textContent = n;
      const label = document.createElement('span');
      label.className = 'stat-label';
      const irregular = { quiz: 'quizzes', summary: 'summaries' };
      label.textContent = n !== 1 && irregular[word] ? irregular[word] : plural(n, word).replace(/^\d+ /, '');
      li.append(num, label);
      return li;
    }));
  }

  function timeAgo(iso) {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function renderCurrent() {
    renderStats($('current-stats'), snapshot());
    const status = $('backup-status');
    const last = meta().lastExport;
    if (!last) {
      status.textContent = "You haven't downloaded a backup yet.";
      status.classList.add('is-stale');
    } else {
      const stale = Date.now() - new Date(last).getTime() > STALE_DAYS * 86400000;
      status.textContent = `Last backup: ${timeAgo(last)} (${formatDate(last)}).` + (stale ? ' Time for a fresh one.' : '');
      status.classList.toggle('is-stale', stale);
    }
  }

  /* ---------- Export ---------- */
  $('export-btn').addEventListener('click', () => {
    const now = new Date();
    const backup = { app: 'The Study Room', format: 1, exportedAt: now.toISOString(), data: snapshot() };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const pad = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `study-room-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setMeta({ lastExport: now.toISOString() });
    $('export-result').textContent = `Saved as ${a.download}`;
    renderCurrent();
  });

  /* ---------- Import ---------- */
  const fileInput = $('file-input');
  const dropzone = $('dropzone');
  const errorEl = $('import-error');
  const preview = $('preview');
  const done = $('import-done');
  let pending = null;

  function showError(msg) {
    errorEl.textContent = msg;
    preview.hidden = true;
    pending = null;
  }

  function validate(obj) {
    if (!obj || typeof obj !== 'object' || !obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
      throw new Error("This doesn't look like a Study Room backup file.");
    }
    const data = {};
    Object.entries(obj.data).forEach(([key, value]) => {
      if (key.startsWith(PREFIX) && !SKIP.has(key) && value != null) data[key] = value;
    });
    if (!Object.keys(data).length) throw new Error('This backup file is empty.');
    if (data[FLASHCARDS] && !Array.isArray(data[FLASHCARDS].decks)) throw new Error('The flashcards in this backup are damaged.');
    if (data[QUIZZES] && !Array.isArray(data[QUIZZES].quizzes)) throw new Error('The quizzes in this backup are damaged.');
    if (data[SUMMARIES] && !Array.isArray(data[SUMMARIES].summaries)) throw new Error('The summaries in this backup are damaged.');
    return data;
  }

  function readFile(file) {
    errorEl.textContent = '';
    done.hidden = true;
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { showError('That file is too large to be a Study Room backup.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        pending = { data: validate(obj), exportedAt: obj.exportedAt, name: file.name };
      } catch (e) {
        showError(e instanceof SyntaxError ? "This file couldn't be read. Make sure it's a .json backup from this site." : e.message);
        return;
      }
      $('preview-name').textContent = pending.name;
      $('preview-date').textContent = pending.exportedAt && !isNaN(new Date(pending.exportedAt))
        ? `Made ${formatDate(pending.exportedAt)}` : '';
      renderStats($('preview-stats'), pending.data);
      preview.hidden = false;
      preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    reader.onerror = () => showError("This file couldn't be opened.");
    reader.readAsText(file);
  }

  fileInput.addEventListener('change', () => { readFile(fileInput.files[0]); fileInput.value = ''; });

  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('is-over')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    readFile(e.dataTransfer.files[0]);
  });

  $('cancel-import').addEventListener('click', () => { pending = null; preview.hidden = true; });

  /* ---------- Merge rules ---------- */
  // Add items (by id) that are missing; never overwrite what's already here.
  function mergeById(current = [], incoming = [], mergeChildren) {
    const result = current.map((item) => ({ ...item }));
    const byId = new Map(result.map((item) => [item.id, item]));
    let added = 0;
    incoming.forEach((item) => {
      const existing = byId.get(item.id);
      if (!existing) { result.push(item); added++; }
      else if (mergeChildren) added += mergeChildren(existing, item);
    });
    return [result, added];
  }

  function mergeFlashcards(cur, inc) {
    if (!cur) return inc;
    const [decks] = mergeById(cur.decks, inc.decks, (existing, item) => {
      const [cards, added] = mergeById(existing.cards, item.cards);
      existing.cards = cards;
      return added;
    });
    return { ...cur, decks };
  }

  function mergeQuizzes(cur, inc) {
    if (!cur) return inc;
    const [quizzes] = mergeById(cur.quizzes, inc.quizzes, (existing, item) => {
      const [questions, added] = mergeById(existing.questions, item.questions);
      existing.questions = questions;
      return added;
    });
    const history = { ...(inc.history || {}) };
    Object.entries(cur.history || {}).forEach(([key, h]) => {
      const other = history[key];
      history[key] = !other ? h : {
        ...h,
        best: Math.max(h.best || 0, other.best || 0),
        attempts: Math.max(h.attempts || 0, other.attempts || 0),
      };
    });
    return { ...cur, quizzes, history };
  }

  function merge(current, incoming) {
    const result = { ...current };
    Object.entries(incoming).forEach(([key, value]) => {
      if (key === FLASHCARDS) result[key] = mergeFlashcards(current[key], value);
      else if (key === QUIZZES) result[key] = mergeQuizzes(current[key], value);
      else if (key === SUMMARIES) result[key] = current[key] ? { ...current[key], summaries: mergeById(current[key].summaries, value.summaries)[0] } : value;
      else if (!(key in current)) result[key] = value; // unknown section: only fill if missing
    });
    return result;
  }

  /* ---------- Apply ---------- */
  function restore(mode) {
    if (!pending) return;
    const before = snapshot();
    if (mode === 'replace' && Object.keys(before).length &&
        !confirm('Replace everything in this browser with the backup? Anything not in the backup will be removed.')) return;

    const next = mode === 'replace' ? pending.data : merge(before, pending.data);
    try {
      writeJSON(UNDO_KEY, before);
      applySnapshot(next);
    } catch (e) {
      try { applySnapshot(before); } catch (e2) { /* nothing more we can do */ }
      showError("Your browser wouldn't save the backup (it may be out of storage space). Nothing was changed.");
      return;
    }

    const cardsBefore = countCards(before);
    const cardsAfter = countCards(next);
    preview.hidden = true;
    pending = null;
    $('import-done-text').textContent = mode === 'replace'
      ? 'Restored. This browser now matches the backup.'
      : `Merged. ${plural(cardsAfter.cards - cardsBefore.cards, 'flashcard')} and ${plural(cardsAfter.questions - cardsBefore.questions, 'quiz question')} added.`;
    $('undo-btn').hidden = false;
    done.hidden = false;
    renderCurrent();
  }

  function countCards(data) {
    const s = Object.fromEntries(summarize(data).map(([n, w]) => [w, n]));
    return { cards: s.flashcard || 0, questions: s.question || 0 };
  }

  $('merge-btn').addEventListener('click', () => restore('merge'));
  $('replace-btn').addEventListener('click', () => restore('replace'));

  $('undo-btn').addEventListener('click', () => {
    const before = readJSON(UNDO_KEY);
    if (!before) return;
    applySnapshot(before);
    localStorage.removeItem(UNDO_KEY);
    $('import-done-text').textContent = 'Undone. Your data is back to how it was before the restore.';
    $('undo-btn').hidden = true;
    renderCurrent();
  });

  renderCurrent();
})();

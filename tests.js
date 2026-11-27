/* The Study Room: Practice Tests
   Questions come from the Quizzes and Flashcards pages (read only).
   Settings, the test in progress and past results are saved in localStorage,
   so a test survives a reload, and the clock keeps running while you're away. */
(() => {
  'use strict';

  const TEST_KEY = 'studyroom.tests.v1';
  const QUIZ_KEY = 'studyroom.quizzes.v1';
  const FLASHCARD_KEY = 'studyroom.flashcards.v1';
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const AUTO_SECONDS_PER_QUESTION = 90;
  const HISTORY_LIMIT = 50;

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const $ = (id) => document.getElementById(id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const normalize = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

  function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) node.append(c); });
    return node;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hrs ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  }

  function formatDuration(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 1) return 'under a minute';
    if (mins < 60) return plural(mins, 'min');
    return `${Math.floor(mins / 60)} hr ${mins % 60 ? plural(mins % 60, 'min') : ''}`.trim();
  }

  const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };

  /* ---------- State ---------- */
  function load() {
    const data = readJSON(TEST_KEY);
    const defaults = { sources: null, count: '20', time: 'auto', pass: 70 };
    if (data && typeof data === 'object') {
      return { settings: { ...defaults, ...data.settings }, active: data.active || null, history: Array.isArray(data.history) ? data.history : [] };
    }
    return { settings: defaults, active: null, history: [] };
  }

  function save() {
    try { localStorage.setItem(TEST_KEY, JSON.stringify(state)); } catch (e) { /* unavailable */ }
  }

  const state = load();

  /* ---------- Question sources ---------- */
  function fromQuizQuestion(q, source) {
    const base = { source, prompt: q.prompt, explanation: q.explanation || '' };
    if (q.type === 'mc') return { ...base, kind: 'choice', options: q.options, correct: q.answer };
    if (q.type === 'tf') return { ...base, kind: 'choice', options: ['True', 'False'], correct: q.answer ? 0 : 1 };
    return { ...base, kind: 'short', answers: q.answers };
  }

  function usableCards(deck) {
    return (deck.cards || []).filter((c) => c.front && c.back && c.front.trim() && c.back.trim());
  }

  function fromDeck(deck) {
    const cards = usableCards(deck);
    return cards.map((card) => {
      const seen = new Set([normalize(card.back)]);
      const distractors = [];
      shuffle(cards.slice()).forEach((other) => {
        const key = normalize(other.back);
        if (distractors.length < 3 && !seen.has(key)) { seen.add(key); distractors.push(other.back); }
      });
      if (!distractors.length) return null;
      const options = shuffle([card.back, ...distractors]);
      return { source: deck.name, kind: 'choice', prompt: card.front, options, correct: options.indexOf(card.back), explanation: '', label: 'Pick the matching answer' };
    }).filter(Boolean);
  }

  function getSources() {
    const quizzes = (readJSON(QUIZ_KEY) || {}).quizzes || [];
    const decks = (readJSON(FLASHCARD_KEY) || {}).decks || [];
    const list = [];
    quizzes.forEach((quiz) => {
      if (!quiz.questions || !quiz.questions.length) return;
      list.push({ key: `quiz:${quiz.id}`, group: 'Quizzes', name: quiz.title, count: quiz.questions.length,
        build: () => quiz.questions.map((q) => fromQuizQuestion(q, quiz.title)) });
    });
    decks.forEach((deck) => {
      if (new Set(usableCards(deck).map((c) => normalize(c.back))).size < 2) return;
      list.push({ key: `deck:${deck.id}`, group: 'Flashcard decks', name: deck.name, count: usableCards(deck).length,
        build: () => fromDeck(deck) });
    });
    return list;
  }

  /* ---------- Views ---------- */
  const views = { setup: $('view-setup'), exam: $('view-exam'), results: $('view-results') };
  function showView(name) {
    Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
    document.body.classList.toggle('in-exam', name === 'exam');
    window.scrollTo({ top: 0 });
  }

  /* ================= SETUP ================= */
  const s = {
    groups: $('source-groups'), none: $('no-sources'), selectAll: $('select-all'),
    count: $('count-select'), time: $('time-select'), pass: $('pass-input'),
    summary: $('summary-text'), start: $('start-btn'),
    resume: $('resume'), resumeText: $('resume-text'), resumeBtn: $('resume-btn'), discardBtn: $('discard-btn'),
    historyPanel: $('history-panel'), historyBody: $('history-body'), clearHistory: $('clear-history'),
  };

  let sources = [];

  function selectedKeys() {
    return [...s.groups.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
  }

  function plan() {
    const keys = new Set(selectedKeys());
    const available = sources.filter((src) => keys.has(src.key)).reduce((n, src) => n + src.count, 0);
    const n = state.settings.count === 'all' ? available : Math.min(Number(state.settings.count), available);
    let minutes = null;
    if (state.settings.time === 'auto') minutes = Math.max(1, Math.ceil((n * AUTO_SECONDS_PER_QUESTION) / 60));
    else if (state.settings.time !== 'none') minutes = Number(state.settings.time);
    return { keys, available, n, minutes };
  }

  function renderSummary() {
    const p = plan();
    s.start.disabled = p.n === 0;
    if (!sources.length) { s.summary.textContent = 'Add quiz questions or flashcards to build a test.'; return; }
    if (p.n === 0) { s.summary.textContent = 'Pick at least one topic to test yourself on.'; return; }
    const parts = [plural(p.n, 'question'), p.minutes ? formatDuration(p.minutes * 60000) : 'no time limit', `pass at ${state.settings.pass}%`];
    s.summary.textContent = parts.join(' · ');
    if (state.settings.count !== 'all' && p.available < Number(state.settings.count)) {
      s.summary.textContent += ` (only ${p.available} available)`;
    }
  }

  function renderSetup() {
    sources = getSources();
    const saved = state.settings.sources;
    const isChecked = (key) => (saved ? saved.includes(key) : true);

    s.none.hidden = sources.length > 0;
    s.selectAll.hidden = sources.length < 2;
    const groups = [...new Set(sources.map((src) => src.group))];
    s.groups.replaceChildren(...groups.map((g) => h('div', { class: 'source-group' },
      h('h3', { text: g }),
      h('ul', { class: 'source-list' }, sources.filter((src) => src.group === g).map((src) => h('li', {},
        h('label', { class: 'source' },
          h('input', { type: 'checkbox', value: src.key, checked: isChecked(src.key), onchange: onSourcesChange }),
          h('span', { class: 'source-name', text: src.name }),
          h('span', { class: 'source-count', text: plural(src.count, src.group === 'Quizzes' ? 'question' : 'card') }),
        ),
      ))),
    )));

    s.count.value = state.settings.count;
    s.time.value = state.settings.time;
    s.pass.value = state.settings.pass;
    renderSummary();
    renderResume();
    renderHistory();
  }

  function onSourcesChange() {
    state.settings.sources = selectedKeys();
    save();
    renderSummary();
  }

  s.selectAll.addEventListener('click', () => {
    const boxes = [...s.groups.querySelectorAll('input[type="checkbox"]')];
    const allOn = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; });
    onSourcesChange();
  });

  s.count.addEventListener('change', () => { state.settings.count = s.count.value; save(); renderSummary(); });
  s.time.addEventListener('change', () => { state.settings.time = s.time.value; save(); renderSummary(); });
  s.pass.addEventListener('change', () => {
    const v = Math.min(100, Math.max(1, Math.round(Number(s.pass.value)) || 70));
    s.pass.value = v;
    state.settings.pass = v;
    save();
    renderSummary();
  });

  s.start.addEventListener('click', () => {
    if (state.active && !confirm('Starting a new test will discard the one you have in progress. Continue?')) return;
    const p = plan();
    const pool = sources.filter((src) => p.keys.has(src.key)).flatMap((src) => src.build());
    const questions = shuffle(pool).slice(0, p.n);
    if (!questions.length) return;
    const chosen = sources.filter((src) => p.keys.has(src.key)).map((src) => src.name);
    const title = chosen.length === 1 ? chosen[0] : `${chosen.length} topics: ${chosen.join(', ')}`;
    beginTest({ title, questions, minutes: p.minutes, pass: state.settings.pass, record: true });
  });

  function renderResume() {
    const a = state.active;
    s.resume.hidden = !a;
    if (!a) return;
    const answered = a.answers.filter((x) => x != null && x !== '').length;
    s.resumeText.textContent = `${a.title} · ${answered} of ${plural(a.questions.length, 'question')} answered` +
      (a.endAt ? ` · ${formatClock(a.endAt - Date.now())} left` : '');
  }

  s.resumeBtn.addEventListener('click', () => openExam());
  s.discardBtn.addEventListener('click', () => {
    if (!confirm('Discard this test? Your answers will be lost.')) return;
    state.active = null;
    save();
    renderResume();
  });

  function renderHistory() {
    s.historyPanel.hidden = state.history.length === 0;
    s.historyBody.replaceChildren(...state.history.map((r) => h('tr', {},
      h('td', { text: new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }),
      h('td', { class: 'test-name', text: `${r.title}${r.retake ? ' (missed questions)' : ''}` }),
      h('td', { class: 'score', text: `${r.pct}%` }),
      h('td', {}, h('span', { class: `pill ${r.passed ? 'pass' : 'fail'}`, text: r.passed ? 'Passed' : 'Not yet' })),
      h('td', { text: `${formatDuration(r.timeUsed)}${r.limitMin ? ` of ${formatDuration(r.limitMin * 60000)}` : ''}` }),
    )));
  }

  s.clearHistory.addEventListener('click', () => {
    if (!confirm('Clear all past test results?')) return;
    state.history = [];
    save();
    renderHistory();
  });

  /* ================= EXAM ================= */
  const x = {
    title: $('exam-title'), answered: $('exam-answered'), timer: $('timer'), timerText: $('timer-text'), announce: $('timer-announce'),
    exit: $('exit-btn'), submit: $('submit-btn'),
    label: $('exam-q-label'), text: $('exam-q-text'), options: $('exam-options'),
    short: $('exam-short'), shortInput: $('exam-short-input'), flag: $('flag-btn'),
    prev: $('prev-q'), next: $('next-q'), grid: $('nav-grid'),
  };

  let ticker = null;
  let announced = new Set();

  function beginTest({ title, questions, minutes, pass, record, retake = false }) {
    const now = Date.now();
    state.active = {
      id: uid(), title, questions, pass, record, retake,
      startedAt: now,
      limitMin: minutes || null,
      endAt: minutes ? now + minutes * 60000 : null,
      answers: questions.map(() => null),
      flags: [],
      index: 0,
    };
    save();
    openExam();
  }

  const isAnswered = (v) => v != null && v !== '';

  function openExam() {
    const a = state.active;
    if (!a) return;
    if (a.endAt && Date.now() >= a.endAt) { submit(true); return; }
    announced = new Set();
    x.title.textContent = a.title;
    showView('exam');
    renderQuestion();
    tick();
    clearInterval(ticker);
    ticker = setInterval(tick, 1000);
  }

  function tick() {
    const a = state.active;
    if (!a) { clearInterval(ticker); return; }
    if (!a.endAt) {
      x.timerText.textContent = formatClock(Date.now() - a.startedAt);
      x.timer.setAttribute('aria-label', 'Time elapsed');
      x.timer.classList.remove('is-warning', 'is-critical');
      return;
    }
    const left = a.endAt - Date.now();
    x.timerText.textContent = formatClock(left);
    x.timer.setAttribute('aria-label', 'Time remaining');
    x.timer.classList.toggle('is-warning', left <= 5 * 60000 && left > 60000);
    x.timer.classList.toggle('is-critical', left <= 60000);
    [[5, '5 minutes left'], [1, '1 minute left']].forEach(([m, msg]) => {
      if (left <= m * 60000 && !announced.has(m) && a.limitMin > m) { announced.add(m); x.announce.textContent = msg; }
    });
    if (left <= 0) submit(true);
  }

  function renderQuestion() {
    const a = state.active;
    const q = a.questions[a.index];
    const total = a.questions.length;
    const answer = a.answers[a.index];

    x.label.textContent = `Question ${a.index + 1} of ${total}${q.source ? ` · ${q.source}` : ''}`;
    x.text.textContent = q.prompt;

    if (q.kind === 'choice') {
      x.short.hidden = true;
      x.options.hidden = false;
      x.options.replaceChildren(...q.options.map((opt, i) => h('button', {
        type: 'button', class: `option${answer === i ? ' is-selected' : ''}`, role: 'radio',
        'aria-checked': String(answer === i), onclick: () => choose(i),
      }, h('span', { class: 'option-key', 'aria-hidden': 'true', text: LETTERS[i] }), h('span', { class: 'option-text', text: opt }))));
    } else {
      x.options.hidden = true;
      x.short.hidden = false;
      x.shortInput.value = answer || '';
    }

    const flagged = a.flags.includes(a.index);
    x.flag.setAttribute('aria-pressed', String(flagged));
    x.flag.textContent = flagged ? '⚑ Flagged' : '⚑ Flag for review';
    x.prev.disabled = a.index === 0;
    x.next.textContent = a.index === total - 1 ? 'Review & submit' : 'Next →';
    renderNavigator();
  }

  function renderNavigator() {
    const a = state.active;
    const answeredCount = a.answers.filter(isAnswered).length;
    x.answered.textContent = `${answeredCount} of ${a.questions.length} answered`;
    x.grid.replaceChildren(...a.questions.map((_, i) => {
      const answered = isAnswered(a.answers[i]);
      const flagged = a.flags.includes(i);
      const cls = ['nav-btn', answered && 'answered', flagged && 'flagged', i === a.index && 'current'].filter(Boolean).join(' ');
      return h('button', {
        type: 'button', class: cls, text: i + 1,
        'aria-label': `Question ${i + 1}${answered ? ', answered' : ', not answered'}${flagged ? ', flagged' : ''}`,
        'aria-current': i === a.index ? 'step' : null,
        onclick: () => goTo(i),
      });
    }));
  }

  function choose(i) {
    const a = state.active;
    a.answers[a.index] = a.answers[a.index] === i ? null : i; // click again to clear
    save();
    renderQuestion();
  }

  function goTo(i) {
    const a = state.active;
    if (i < 0 || i >= a.questions.length) return;
    a.index = i;
    save();
    renderQuestion();
    x.text.focus({ preventScroll: true });
    if (x.text.getBoundingClientRect().top < 80) x.text.scrollIntoView({ block: 'center' });
  }

  x.shortInput.addEventListener('input', () => {
    state.active.answers[state.active.index] = x.shortInput.value;
    save();
    renderNavigator();
  });
  x.shortInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); x.next.click(); } });

  function toggleFlag() {
    const a = state.active;
    a.flags = a.flags.includes(a.index) ? a.flags.filter((f) => f !== a.index) : [...a.flags, a.index];
    save();
    renderQuestion();
  }

  x.flag.addEventListener('click', toggleFlag);
  x.prev.addEventListener('click', () => goTo(state.active.index - 1));
  x.next.addEventListener('click', () => {
    const a = state.active;
    if (a.index < a.questions.length - 1) goTo(a.index + 1);
    else x.submit.click();
  });

  x.submit.addEventListener('click', () => {
    const a = state.active;
    const unanswered = a.answers.filter((v) => !isAnswered(v)).length;
    const flagged = a.flags.length;
    let msg = 'Submit your test? You can\'t change answers after this.';
    if (unanswered || flagged) {
      msg = [unanswered && `${plural(unanswered, 'question')} unanswered`, flagged && `${flagged} flagged for review`].filter(Boolean).join(' and ');
      msg = `You have ${msg}.\n\nSubmit anyway?`;
    }
    if (confirm(msg)) submit(false);
  });

  x.exit.addEventListener('click', () => {
    clearInterval(ticker);
    renderSetup();
    showView('setup');
  });

  document.addEventListener('keydown', (e) => {
    if (views.exam.hidden || !state.active || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select')) return;
    const q = state.active.questions[state.active.index];
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(state.active.index + 1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(state.active.index - 1); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFlag(); return; }
    if (q.kind !== 'choice') return;
    let i = -1;
    if (/^[1-6]$/.test(e.key)) i = Number(e.key) - 1;
    else if (/^[a-e]$/i.test(e.key)) i = e.key.toUpperCase().charCodeAt(0) - 65;
    if (i >= 0 && i < q.options.length) { e.preventDefault(); choose(i); }
  });

  /* ================= GRADING & RESULTS ================= */
  function isCorrect(q, answer) {
    if (!isAnswered(answer)) return false;
    if (q.kind === 'choice') return answer === q.correct;
    return q.answers.some((a) => normalize(a) === normalize(answer));
  }

  function score(result) {
    const correct = result.correct.filter(Boolean).length;
    const total = result.questions.length;
    result.pct = Math.round((correct / total) * 100);
    result.passed = result.pct >= result.pass;
    result.correctCount = correct;
    return result;
  }

  let result = null;

  function submit(timeUp) {
    clearInterval(ticker);
    const a = state.active;
    if (!a) return;
    const finishedAt = a.endAt ? Math.min(Date.now(), a.endAt) : Date.now();
    result = score({
      id: a.id, title: a.title, questions: a.questions, answers: a.answers, flags: a.flags,
      correct: a.questions.map((q, i) => isCorrect(q, a.answers[i])), overrides: [],
      pass: a.pass, limitMin: a.limitMin, timeUsed: finishedAt - a.startedAt,
      record: a.record, retake: a.retake, timeUp,
    });
    state.active = null;
    if (result.record) {
      state.history.unshift(historyEntry(result));
      state.history = state.history.slice(0, HISTORY_LIMIT);
    }
    save();
    renderResults();
    showView('results');
  }

  function historyEntry(r) {
    return { id: r.id, date: new Date().toISOString(), title: r.title, pct: r.pct, passed: r.passed, total: r.questions.length,
      correct: r.correctCount, timeUsed: r.timeUsed, limitMin: r.limitMin, retake: r.retake };
  }

  function updateHistory() {
    const entry = state.history.find((e) => e.id === result.id);
    if (entry) Object.assign(entry, { pct: result.pct, passed: result.passed, correct: result.correctCount });
    save();
  }

  const rr = {
    title: $('r-title'), timeup: $('r-timeup'), ring: $('r-ring'), pct: $('r-pct'), verdict: $('r-verdict'),
    heading: $('r-heading'), stats: $('r-stats'), actions: $('r-actions'),
    breakdownPanel: $('r-breakdown-panel'), breakdown: $('r-breakdown'),
    filter: $('r-filter'), review: $('r-review'), reviewEmpty: $('r-review-empty'),
  };

  function headline(r) {
    if (r.pct === 100) return 'Flawless. You\'re ready.';
    if (r.passed && r.pct - r.pass >= 15) return 'You\'re well prepared.';
    if (r.passed) return 'You passed. Tighten up the weak spots.';
    if (r.pass - r.pct <= 10) return 'So close. A little more review will get you there.';
    return 'Now you know exactly what to study.';
  }

  function renderResults() {
    const r = result;
    rr.title.textContent = r.retake ? `${r.title} · missed questions` : r.title;
    rr.timeup.hidden = !r.timeUp;
    rr.pct.textContent = `${r.pct}%`;
    rr.ring.style.setProperty('--pct', r.pct);
    rr.ring.style.setProperty('--ring', r.passed ? 'var(--known)' : 'var(--danger)');
    rr.ring.setAttribute('aria-label', `Score: ${r.pct} percent`);
    rr.verdict.replaceChildren(h('span', { class: `pill ${r.passed ? 'pass' : 'fail'}`, text: r.passed ? `Passed (needed ${r.pass}%)` : `Not yet (needed ${r.pass}%)` }));
    rr.heading.textContent = headline(r);

    const unanswered = r.answers.filter((v) => !isAnswered(v)).length;
    rr.stats.replaceChildren(
      h('li', {}, h('strong', { text: `${r.correctCount} of ${r.questions.length}` }), ' correct'),
      h('li', {}, h('strong', { text: formatDuration(r.timeUsed) }), r.limitMin ? ` of ${formatDuration(r.limitMin * 60000)}` : ' taken'),
      unanswered ? h('li', {}, h('strong', { text: unanswered }), ' left blank') : null,
    );

    const missedIdx = r.questions.map((_, i) => i).filter((i) => !r.correct[i]);
    const actions = [];
    if (missedIdx.length) {
      actions.push(h('button', { type: 'button', class: 'btn btn-primary', text: `Retest the ${missedIdx.length} I missed`, onclick: () => {
        const qs = shuffle(missedIdx.map((i) => r.questions[i]));
        const minutes = r.limitMin ? Math.max(1, Math.ceil((qs.length * AUTO_SECONDS_PER_QUESTION) / 60)) : null;
        beginTest({ title: r.title, questions: qs, minutes, pass: r.pass, record: true, retake: true });
      } }));
    }
    actions.push(h('button', { type: 'button', class: `btn ${missedIdx.length ? 'btn-ghost' : 'btn-primary'}`, text: 'New test', onclick: () => { renderSetup(); showView('setup'); } }));
    rr.actions.replaceChildren(...actions);

    // Per-topic breakdown (only useful with more than one source)
    const by = new Map();
    r.questions.forEach((q, i) => {
      const k = q.source || 'Other';
      const v = by.get(k) || { total: 0, correct: 0 };
      v.total++;
      if (r.correct[i]) v.correct++;
      by.set(k, v);
    });
    rr.breakdownPanel.hidden = by.size < 2;
    rr.breakdown.replaceChildren(...[...by.entries()].sort((p, q) => p[1].correct / p[1].total - q[1].correct / q[1].total).map(([name, v]) => {
      const pct = Math.round((v.correct / v.total) * 100);
      return h('li', {},
        h('div', { class: 'breakdown-row' }, h('span', { text: name }), h('span', { text: `${v.correct}/${v.total} · ${pct}%` })),
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: pct >= 80 ? '' : pct >= 50 ? 'mid' : 'low', style: `width:${pct}%` })),
      );
    }));

    rr.filter.value = 'all';
    renderReview();
  }

  function answerText(q, v) {
    if (!isAnswered(v)) return '(no answer)';
    return q.kind === 'choice' ? q.options[v] : v;
  }

  function renderReview() {
    const r = result;
    const f = rr.filter.value;
    const items = r.questions.map((q, i) => {
      const ok = r.correct[i];
      const flagged = r.flags.includes(i);
      if ((f === 'missed' && ok) || (f === 'flagged' && !flagged)) return null;
      const canOverride = !ok && q.kind === 'short' && isAnswered(r.answers[i]);
      return h('li', { class: `review-item${ok ? '' : ' is-wrong'}` },
        h('span', { class: 'review-mark', 'aria-label': ok ? 'Correct' : 'Incorrect', text: ok ? '✓' : '✗' }),
        h('div', { class: 'review-body' },
          h('p', { class: 'review-q', text: `${i + 1}. ${q.prompt}` }),
          h('p', { class: 'review-line' }, 'Your answer: ', h('strong', { text: answerText(q, r.answers[i]) }), r.overrides.includes(i) ? ' (counted as correct)' : ''),
          ok ? null : h('p', { class: 'review-line' }, 'Correct answer: ', h('strong', { text: q.kind === 'choice' ? q.options[q.correct] : q.answers[0] })),
          q.explanation ? h('p', { class: 'review-explain', text: q.explanation }) : null,
          canOverride ? h('button', { type: 'button', class: 'review-override', text: 'I was right, count it', onclick: () => {
            r.correct[i] = true;
            r.overrides.push(i);
            score(r);
            if (r.record) updateHistory();
            renderResults();
          } }) : null,
          h('div', { class: 'review-tags' },
            q.source ? h('span', { class: 'chip', text: q.source }) : null,
            flagged ? h('span', { class: 'chip flag', text: '⚑ Flagged' }) : null,
          ),
        ));
    }).filter(Boolean);
    rr.review.replaceChildren(...items);
    rr.reviewEmpty.hidden = items.length > 0;
  }

  rr.filter.addEventListener('change', renderReview);

  /* ---------- Start ---------- */
  renderSetup();
  if (state.active && state.active.endAt && Date.now() >= state.active.endAt) {
    submit(true); // time ran out while the page was closed
  } else {
    showView('setup');
  }
})();

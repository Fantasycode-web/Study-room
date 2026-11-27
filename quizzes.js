/* The Study Room: Practice Quizzes
   Quizzes, scores and settings are saved in this browser's localStorage.
   Flashcard decks are read (never changed) from the Flashcards page's storage. */
(() => {
  'use strict';

  const QUIZ_KEY = 'studyroom.quizzes.v1';
  const FLASHCARD_KEY = 'studyroom.flashcards.v1';
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const MC_SLOTS = 4;

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const $ = (id) => document.getElementById(id);

  // Tiny element builder: h('p', { class: 'x', text: 'hi' }, child, ...)
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const normalize = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

  /* ---------- Data ---------- */
  function sampleQuiz() {
    const q = (type, prompt, rest) => ({ id: uid(), type, prompt, explanation: '', ...rest });
    return {
      id: uid(),
      title: 'Sample: How memory works',
      questions: [
        q('mc', 'Which study method involves testing yourself instead of re-reading?', {
          options: ['Highlighting', 'Active recall', 'Re-reading your notes', 'Copying the textbook'], answer: 1,
          explanation: 'Pulling information out of memory strengthens it far more than looking at it again.' }),
        q('tf', 'Cramming the night before builds stronger long-term memory than spreading study sessions out.', {
          answer: false, explanation: 'Spacing sessions out (spaced repetition) wins for long-term memory.' }),
        q('mc', 'What does "interleaving" mean?', {
          options: ['Studying one topic until it\'s perfect', 'Taking breaks every 25 minutes', 'Mixing different topics or problem types in one session', 'Reading two books at once'], answer: 2,
          explanation: 'Mixing problem types forces you to choose the right approach, not just repeat one.' }),
        q('short', 'Who first described the forgetting curve?', {
          answers: ['Hermann Ebbinghaus', 'Ebbinghaus'], explanation: 'Hermann Ebbinghaus, a German psychologist, in the 1880s.' }),
        q('tf', 'Pairing words with diagrams can make ideas easier to remember.', {
          answer: true, explanation: 'This is called dual coding: two routes to the same memory.' }),
        q('mc', 'With spaced repetition, when is the best time to review something?', {
          options: ['Constantly, every hour', 'Just before you would forget it', 'Only the night before the exam', 'Never; once is enough'], answer: 1,
          explanation: 'Reviewing right at the edge of forgetting gives the biggest memory boost.' }),
        q('short', 'What is it called when you explain new ideas in your own words and link them to what you already know?', {
          answers: ['Elaboration'], explanation: '' }),
      ],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(QUIZ_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.quizzes)) {
          data.history = data.history || {};
          data.settings = { count: '10', shuffle: true, ...data.settings };
          return data;
        }
      }
    } catch (e) { /* unavailable or corrupt: start fresh */ }
    return { quizzes: [sampleQuiz()], history: {}, settings: { count: '10', shuffle: true } };
  }

  function save() {
    try { localStorage.setItem(QUIZ_KEY, JSON.stringify(state)); } catch (e) { /* unavailable */ }
  }

  function loadDecks() {
    try {
      const data = JSON.parse(localStorage.getItem(FLASHCARD_KEY) || 'null');
      return data && Array.isArray(data.decks) ? data.decks : [];
    } catch (e) { return []; }
  }

  const state = load();
  const findQuiz = (id) => state.quizzes.find((q) => q.id === id);

  /* ---------- Turning sources into runnable questions ---------- */
  function fromQuizQuestion(q) {
    if (q.type === 'mc') {
      return { kind: 'choice', prompt: q.prompt, options: q.options, correct: q.answer, explanation: q.explanation };
    }
    if (q.type === 'tf') {
      return { kind: 'choice', prompt: q.prompt, options: ['True', 'False'], correct: q.answer ? 0 : 1, explanation: q.explanation, label: 'True or false' };
    }
    return { kind: 'short', prompt: q.prompt, answers: q.answers, explanation: q.explanation };
  }

  function usableCards(deck) {
    return deck.cards.filter((c) => c.front && c.back && c.front.trim() && c.back.trim());
  }

  function deckIsQuizzable(deck) {
    return new Set(usableCards(deck).map((c) => normalize(c.back))).size >= 2;
  }

  function fromDeck(deck) {
    const cards = usableCards(deck);
    return cards.map((card) => {
      const seen = new Set([normalize(card.back)]);
      const distractors = [];
      shuffle(cards.slice()).forEach((other) => {
        const key = normalize(other.back);
        if (distractors.length < MC_SLOTS - 1 && !seen.has(key)) { seen.add(key); distractors.push(other.back); }
      });
      if (!distractors.length) return null;
      const options = shuffle([card.back, ...distractors]);
      return {
        kind: 'choice', prompt: card.front, options, correct: options.indexOf(card.back),
        explanation: '', label: 'Pick the matching answer',
      };
    }).filter(Boolean);
  }

  /* ---------- Views ---------- */
  const views = { library: $('view-library'), run: $('view-run'), results: $('view-results'), builder: $('view-builder') };

  function showView(name) {
    Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
    window.scrollTo({ top: 0 });
  }

  /* ---------- Library ---------- */
  const el = {
    count: $('count-select'), shuffle: $('shuffle-toggle'),
    quizGrid: $('quiz-grid'), deckGrid: $('deck-grid'), deckEmpty: $('deck-empty'), newQuiz: $('new-quiz-btn'),
  };

  function scoreChips(key) {
    const hist = state.history[key];
    if (!hist) return [h('span', { class: 'chip', text: 'Not taken yet' })];
    const tone = (p) => (p >= 80 ? 'chip good' : p >= 50 ? 'chip mid' : 'chip');
    return [
      h('span', { class: tone(hist.best), text: `Best ${hist.best}%` }),
      h('span', { class: tone(hist.last), text: `Last ${hist.last}%` }),
      h('span', { class: 'chip', text: plural(hist.attempts, 'attempt') }),
    ];
  }

  function renderLibrary() {
    el.count.value = state.settings.count;
    el.shuffle.checked = state.settings.shuffle;

    el.quizGrid.replaceChildren(...state.quizzes.map((quiz) => h('article', { class: 'quiz-card' },
      h('h3', { text: quiz.title }),
      h('p', { class: 'meta', text: plural(quiz.questions.length, 'question') }),
      h('div', { class: 'score-chips' }, scoreChips(quiz.id)),
      h('div', { class: 'card-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-small', disabled: quiz.questions.length === 0,
          text: 'Start', 'aria-label': `Start ${quiz.title}`, onclick: () => startQuiz(quiz.id) }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Edit',
          'aria-label': `Edit ${quiz.title}`, onclick: () => openBuilder(quiz.id) }),
      ),
    )));
    if (!state.quizzes.length) {
      el.quizGrid.append(h('p', { class: 'help', text: 'No quizzes yet. Create one with "+ New quiz".' }));
    }

    const decks = loadDecks().filter(deckIsQuizzable);
    el.deckEmpty.hidden = decks.length > 0;
    el.deckGrid.replaceChildren(...decks.map((deck) => h('article', { class: 'quiz-card' },
      h('h3', { text: deck.name }),
      h('p', { class: 'meta', text: `${plural(usableCards(deck).length, 'card')} · multiple choice` }),
      h('div', { class: 'score-chips' }, scoreChips(`deck:${deck.id}`)),
      h('div', { class: 'card-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Start',
          'aria-label': `Start quiz on ${deck.name}`, onclick: () => startDeckQuiz(deck.id) }),
      ),
    )));
  }

  el.count.addEventListener('change', () => { state.settings.count = el.count.value; save(); });
  el.shuffle.addEventListener('change', () => { state.settings.shuffle = el.shuffle.checked; save(); });
  el.newQuiz.addEventListener('click', () => {
    const quiz = { id: uid(), title: 'Untitled quiz', questions: [] };
    state.quizzes.push(quiz);
    save();
    openBuilder(quiz.id);
    $('title-input').select();
  });

  /* ---------- Running a quiz ---------- */
  const r = {
    title: $('run-title'), counter: $('run-counter'), score: $('run-score'),
    progress: $('run-progress'), progressBar: $('run-progress-bar'),
    label: $('question-label'), question: $('question-text'), options: $('options'),
    shortForm: $('short-form'), shortInput: $('short-input'),
    feedback: $('feedback'), fbTitle: $('feedback-title'), fbText: $('feedback-text'), fbExplain: $('feedback-explain'),
    override: $('override-btn'), next: $('next-btn'), quit: $('quit-btn'), shortcuts: $('run-shortcuts'),
  };

  let run = null;

  function limitQuestions(list) {
    let qs = list.slice();
    if (state.settings.shuffle) shuffle(qs);
    if (state.settings.count !== 'all') qs = qs.slice(0, Number(state.settings.count));
    return qs;
  }

  function startQuiz(id) {
    const quiz = findQuiz(id);
    if (!quiz || !quiz.questions.length) return;
    beginRun(id, quiz.title, limitQuestions(quiz.questions.map(fromQuizQuestion)), true);
  }

  function startDeckQuiz(deckId) {
    const deck = loadDecks().find((d) => d.id === deckId);
    if (!deck) return;
    beginRun(`deck:${deck.id}`, deck.name, limitQuestions(fromDeck(deck)), true);
  }

  function beginRun(key, title, questions, recordScore) {
    run = { key, title, questions, index: 0, answers: [], recordScore };
    r.title.textContent = title;
    showView('run');
    renderQuestion();
  }

  function correctText(q) {
    return q.kind === 'choice' ? q.options[q.correct] : q.answers[0];
  }

  function renderQuestion() {
    const q = run.questions[run.index];
    const total = run.questions.length;
    const score = run.answers.filter((a) => a.correct).length;

    r.counter.textContent = `Question ${run.index + 1} of ${total}`;
    r.score.textContent = `Score: ${score}`;
    const pct = Math.round((run.index / total) * 100);
    r.progressBar.style.width = `${pct}%`;
    r.progress.setAttribute('aria-valuenow', String(pct));

    r.label.textContent = q.label || (q.kind === 'short' ? 'Short answer' : 'Multiple choice');
    r.question.textContent = q.prompt;
    r.feedback.hidden = true;
    r.override.hidden = true;
    r.next.hidden = true;

    if (q.kind === 'choice') {
      r.shortForm.hidden = true;
      r.options.hidden = false;
      r.shortcuts.hidden = false;
      r.options.replaceChildren(...q.options.map((opt, i) => h('button', {
        type: 'button', class: 'option', 'data-index': i, onclick: () => answerChoice(i),
      }, h('span', { class: 'option-key', 'aria-hidden': 'true', text: LETTERS[i] }), h('span', { class: 'option-text', text: opt }))));
      r.question.focus({ preventScroll: true });
    } else {
      r.options.hidden = true;
      r.shortcuts.hidden = true;
      r.shortForm.hidden = false;
      r.shortInput.value = '';
      r.shortInput.disabled = false;
      r.shortInput.className = '';
      r.shortForm.querySelector('button').disabled = false;
      r.shortInput.focus({ preventScroll: true });
    }
  }

  function showFeedback(correct, q, given) {
    r.feedback.hidden = false;
    r.feedback.classList.toggle('is-wrong', !correct);
    r.fbTitle.textContent = correct ? 'Correct!' : (given === '' ? 'Skipped' : 'Not quite.');
    r.fbText.textContent = correct ? '' : `The answer is: ${correctText(q)}`;
    r.fbExplain.textContent = q.explanation || '';
    r.score.textContent = `Score: ${run.answers.filter((a) => a.correct).length}`;
    r.next.textContent = run.index === run.questions.length - 1 ? 'See results' : 'Next question';
    r.next.hidden = false;
    r.next.focus({ preventScroll: true });
  }

  function answerChoice(i) {
    if (run.answers[run.index]) return;
    const q = run.questions[run.index];
    const correct = i === q.correct;
    run.answers[run.index] = { correct, given: q.options[i] };

    r.options.querySelectorAll('.option').forEach((btn, j) => {
      btn.disabled = true;
      if (j === q.correct) btn.classList.add('is-correct');
      else if (j === i) btn.classList.add('is-wrong');
      else btn.classList.add('is-dim');
    });
    showFeedback(correct, q, q.options[i]);
  }

  r.shortForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (run.answers[run.index]) return;
    const q = run.questions[run.index];
    const given = r.shortInput.value.trim();
    const correct = given !== '' && q.answers.some((a) => normalize(a) === normalize(given));
    run.answers[run.index] = { correct, given };

    r.shortInput.disabled = true;
    r.shortForm.querySelector('button').disabled = true;
    r.shortInput.classList.add(correct ? 'is-correct' : 'is-wrong');
    showFeedback(correct, q, given);
    r.override.hidden = correct || given === '';
  });

  // For typos or wording the accepted-answers list didn't anticipate.
  r.override.addEventListener('click', () => {
    const a = run.answers[run.index];
    a.correct = true;
    a.overridden = true;
    r.override.hidden = true;
    r.shortInput.classList.replace('is-wrong', 'is-correct');
    showFeedback(true, run.questions[run.index], a.given);
  });

  r.next.addEventListener('click', () => {
    if (!run.answers[run.index]) return;
    if (run.index < run.questions.length - 1) {
      run.index++;
      renderQuestion();
    } else {
      finishRun();
    }
  });

  r.quit.addEventListener('click', () => {
    if (run.answers.length && !confirm('Quit this quiz? Your progress on it won\'t be saved.')) return;
    run = null;
    renderLibrary();
    showView('library');
  });

  document.addEventListener('keydown', (e) => {
    if (views.run.hidden || !run || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select')) return;
    const q = run.questions[run.index];
    const answered = !!run.answers[run.index];

    if (e.key === 'Enter') {
      if (e.target.closest('button')) return; // the focused button handles it
      if (answered) { e.preventDefault(); r.next.click(); }
      return;
    }
    if (answered || q.kind !== 'choice') return;
    let i = -1;
    if (/^[1-6]$/.test(e.key)) i = Number(e.key) - 1;
    else if (/^[a-f]$/i.test(e.key)) i = e.key.toUpperCase().charCodeAt(0) - 65;
    if (i >= 0 && i < q.options.length) { e.preventDefault(); answerChoice(i); }
  });

  /* ---------- Results ---------- */
  const res = {
    quiz: $('results-quiz'), ring: $('score-ring'), pct: $('score-pct'),
    title: $('results-title'), text: $('results-text'), actions: $('results-actions'),
    missedOnly: $('missed-only'), list: $('review-list'),
  };

  function verdict(pct) {
    if (pct === 100) return ['Perfect score!', 'You nailed every question. Come back in a few days to make sure it sticks.'];
    if (pct >= 85) return ['Outstanding', 'You really know this. Clean up the last few and you\'re there.'];
    if (pct >= 70) return ['Solid work', 'Most of it is sticking. Review the ones you missed while they\'re fresh.'];
    if (pct >= 50) return ['Getting there', 'Good foundation. Run the missed questions again to close the gaps.'];
    return ['Good start', 'Now you know exactly what to review. That\'s the whole point of a practice quiz.'];
  }

  function finishRun() {
    const total = run.questions.length;
    const correct = run.answers.filter((a) => a.correct).length;
    const pct = Math.round((correct / total) * 100);

    if (run.recordScore) {
      const prev = state.history[run.key] || { best: 0, attempts: 0 };
      state.history[run.key] = { best: Math.max(prev.best, pct), last: pct, attempts: prev.attempts + 1, date: new Date().toISOString() };
      save();
    }

    const [title, text] = verdict(pct);
    res.quiz.textContent = run.recordScore ? run.title : `${run.title} · missed questions`;
    res.pct.textContent = `${pct}%`;
    res.ring.style.setProperty('--pct', pct);
    res.ring.style.setProperty('--ring', pct >= 80 ? 'var(--known)' : pct >= 50 ? 'var(--learning)' : 'var(--danger)');
    res.ring.setAttribute('aria-label', `Score: ${pct} percent`);
    res.title.textContent = title;
    res.text.textContent = `You got ${correct} of ${plural(total, 'question')} right. ${text}`;

    const finished = run;
    const missed = finished.questions.filter((_, i) => !finished.answers[i].correct);
    const actions = [];
    if (missed.length) {
      actions.push(h('button', { type: 'button', class: 'btn btn-primary', text: `Retry the ${missed.length} I missed`,
        onclick: () => beginRun(finished.key, finished.title, missed, false) }));
    }
    actions.push(h('button', { type: 'button', class: `btn ${missed.length ? 'btn-ghost' : 'btn-primary'}`, text: 'Take it again',
      onclick: () => (finished.key.startsWith('deck:') ? startDeckQuiz(finished.key.slice(5)) : startQuiz(finished.key)) }));
    actions.push(h('button', { type: 'button', class: 'btn btn-ghost', text: 'All quizzes',
      onclick: () => { renderLibrary(); showView('library'); } }));
    res.actions.replaceChildren(...actions);

    res.missedOnly.checked = false;
    res.missedOnly.disabled = missed.length === 0;
    renderReview();
    showView('results');
  }

  function renderReview() {
    const onlyMissed = res.missedOnly.checked;
    res.list.replaceChildren(...run.questions.map((q, i) => {
      const a = run.answers[i];
      if (onlyMissed && a.correct) return null;
      return h('li', { class: `review-item${a.correct ? '' : ' is-wrong'}` },
        h('span', { class: 'review-mark', 'aria-label': a.correct ? 'Correct' : 'Incorrect', text: a.correct ? '✓' : '✗' }),
        h('div', { class: 'review-body' },
          h('p', { class: 'review-q', text: `${i + 1}. ${q.prompt}` }),
          h('p', { class: 'review-line' }, 'Your answer: ', h('strong', { text: a.given || '(blank)' }), a.overridden ? ' (counted as correct)' : ''),
          a.correct ? null : h('p', { class: 'review-line' }, 'Correct answer: ', h('strong', { text: correctText(q) })),
          q.explanation ? h('p', { class: 'review-explain', text: q.explanation }) : null,
        ));
    }).filter(Boolean));
  }

  res.missedOnly.addEventListener('change', renderReview);

  /* ---------- Builder ---------- */
  const b = {
    back: $('builder-back'), title: $('title-input'), start: $('builder-start'), del: $('delete-quiz-btn'),
    form: $('q-form'), formTitle: $('q-form-title'), type: $('q-type'), prompt: $('q-prompt'),
    mcRows: $('mc-rows'), answers: $('q-answers'), explain: $('q-explain'),
    error: $('q-error'), submit: $('q-submit'), cancel: $('q-cancel'),
    list: $('q-list'), listTitle: $('q-list-title'), listEmpty: $('q-list-empty'),
    fields: { mc: $('fields-mc'), tf: $('fields-tf'), short: $('fields-short') },
  };

  let editingQuizId = null;
  let editingQuestionId = null;

  // Build the multiple-choice option rows once.
  b.mcRows.replaceChildren(...Array.from({ length: MC_SLOTS }, (_, i) => h('div', { class: 'mc-row' },
    h('input', { type: 'radio', name: 'mc-correct', value: i, 'aria-label': `Option ${LETTERS[i]} is correct`, checked: i === 0 }),
    h('input', { type: 'text', class: 'mc-option', placeholder: `Option ${LETTERS[i]}`, 'aria-label': `Option ${LETTERS[i]}` }),
  )));
  const mcInputs = () => [...b.mcRows.querySelectorAll('.mc-option')];
  const mcRadios = () => [...b.mcRows.querySelectorAll('input[type="radio"]')];

  const quiz = () => findQuiz(editingQuizId);

  function setType(type) {
    b.type.value = type;
    Object.entries(b.fields).forEach(([k, f]) => { f.hidden = k !== type; });
  }

  b.type.addEventListener('change', () => { setType(b.type.value); b.error.textContent = ''; });

  function resetQuestionForm(keepType = true) {
    const type = keepType ? b.type.value : 'mc';
    editingQuestionId = null;
    b.form.reset();
    mcRadios()[0].checked = true;
    setType(type);
    b.error.textContent = '';
    b.formTitle.textContent = 'Add a question';
    b.submit.textContent = 'Add question';
    b.cancel.hidden = true;
  }

  function openBuilder(id) {
    editingQuizId = id;
    resetQuestionForm(false);
    b.title.value = quiz().title;
    renderBuilderList();
    showView('builder');
  }

  function answerSummary(q) {
    if (q.type === 'mc') return `Answer: ${q.options[q.answer]}`;
    if (q.type === 'tf') return `Answer: ${q.answer ? 'True' : 'False'}`;
    return `Accepts: ${q.answers.join(' / ')}`;
  }

  const TYPE_NAMES = { mc: 'Multiple choice', tf: 'True or false', short: 'Short answer' };

  function renderBuilderList() {
    const qs = quiz().questions;
    b.listTitle.textContent = `Questions (${qs.length})`;
    b.listEmpty.hidden = qs.length > 0;
    b.start.disabled = qs.length === 0;
    b.list.replaceChildren(...qs.map((q) => h('li', { class: q.id === editingQuestionId ? 'is-editing' : null },
      h('div', { class: 'q-body' },
        h('p', { class: 'q-prompt', text: q.prompt }),
        h('p', { class: 'q-answer', text: answerSummary(q) }),
        h('span', { class: 'badge', text: TYPE_NAMES[q.type] }),
      ),
      h('div', { class: 'item-actions' },
        h('button', { type: 'button', text: 'Edit', 'aria-label': `Edit question: ${q.prompt}`, onclick: () => editQuestion(q.id) }),
        h('button', { type: 'button', class: 'item-delete', text: 'Delete', 'aria-label': `Delete question: ${q.prompt}`, onclick: () => deleteQuestion(q.id) }),
      ),
    )));
  }

  function editQuestion(id) {
    const q = quiz().questions.find((x) => x.id === id);
    if (!q) return;
    resetQuestionForm();
    editingQuestionId = id;
    setType(q.type);
    b.prompt.value = q.prompt;
    b.explain.value = q.explanation || '';
    if (q.type === 'mc') {
      mcInputs().forEach((input, i) => { input.value = q.options[i] || ''; });
      mcRadios()[q.answer].checked = true;
    } else if (q.type === 'tf') {
      b.form.querySelector(`input[name="tf-answer"][value="${q.answer}"]`).checked = true;
    } else {
      b.answers.value = q.answers.join('\n');
    }
    b.formTitle.textContent = 'Edit question';
    b.submit.textContent = 'Save changes';
    b.cancel.hidden = false;
    renderBuilderList();
    b.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    b.prompt.focus({ preventScroll: true });
  }

  function deleteQuestion(id) {
    const q = quiz().questions.find((x) => x.id === id);
    if (!q || !confirm(`Delete this question?\n\n${q.prompt}`)) return;
    quiz().questions = quiz().questions.filter((x) => x.id !== id);
    if (editingQuestionId === id) resetQuestionForm();
    save();
    renderBuilderList();
  }

  function readForm() {
    const type = b.type.value;
    const prompt = b.prompt.value.trim();
    const explanation = b.explain.value.trim();
    if (!prompt) return { error: 'Write the question first.' };

    if (type === 'mc') {
      // Keep filled options in order; remember which one is marked correct.
      const checked = mcRadios().findIndex((r) => r.checked);
      const options = [];
      let answer = -1;
      mcInputs().forEach((input, i) => {
        const v = input.value.trim();
        if (!v) return;
        if (i === checked) answer = options.length;
        options.push(v);
      });
      if (options.length < 2) return { error: 'Add at least two answer options.' };
      if (answer < 0) return { error: 'The option marked correct is empty. Fill it in or pick another.' };
      return { type, prompt, options, answer, explanation };
    }
    if (type === 'tf') {
      const answer = b.form.querySelector('input[name="tf-answer"]:checked').value === 'true';
      return { type, prompt, answer, explanation };
    }
    const answers = b.answers.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!answers.length) return { error: 'Add at least one accepted answer.' };
    return { type, prompt, answers, explanation };
  }

  b.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = readForm();
    if (data.error) { b.error.textContent = data.error; return; }

    const qs = quiz().questions;
    const existing = editingQuestionId && qs.find((x) => x.id === editingQuestionId);
    if (existing) {
      // Replace fields wholesale so a changed type doesn't leave stale ones.
      Object.keys(existing).forEach((k) => { if (k !== 'id') delete existing[k]; });
      Object.assign(existing, data);
    } else {
      qs.push({ id: uid(), ...data });
    }
    save();
    resetQuestionForm();
    renderBuilderList();
    b.prompt.focus();
  });

  b.cancel.addEventListener('click', () => { resetQuestionForm(); renderBuilderList(); });

  b.title.addEventListener('input', () => {
    quiz().title = b.title.value.trim() || 'Untitled quiz';
    save();
  });

  b.back.addEventListener('click', () => { renderLibrary(); showView('library'); });
  b.start.addEventListener('click', () => startQuiz(editingQuizId));

  b.del.addEventListener('click', () => {
    const q = quiz();
    if (!confirm(`Delete "${q.title}" and its ${plural(q.questions.length, 'question')}? This can't be undone.`)) return;
    state.quizzes = state.quizzes.filter((x) => x.id !== q.id);
    delete state.history[q.id];
    save();
    renderLibrary();
    showView('library');
  });

  /* ---------- Start ---------- */
  save(); // persist the starter quiz so other pages (like Practice Tests) can see it
  renderLibrary();
  showView('library');
  const deepLink = location.hash.match(/^#start\/(.+)$/);
  if (deepLink) {
    history.replaceState(null, '', location.pathname + location.search);
    startQuiz(decodeURIComponent(deepLink[1]));
  }
})();

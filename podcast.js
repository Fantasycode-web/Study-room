/* The Study Room: The Podcast
   Turns each summary into a narrated episode using the browser's built-in voices
   (Web Speech API). Nothing is uploaded; it all runs on this device.
   Settings and listening progress are saved in localStorage. */
(() => {
  'use strict';

  const KEY = 'studyroom.podcast.v1';
  const SUMMARY_KEY = 'studyroom.summaries.v1';
  const WORDS_PER_SECOND = 2.6; // typical speech at 1x, for time estimates

  const STYLES = {
    narrator: { pitch: 0.72, rate: 0.86, pauseScale: 1.35 }, // deep, warm, unhurried
    natural: { pitch: 1, rate: 1, pauseScale: 1 },
    brisk: { pitch: 1, rate: 1.2, pauseScale: 0.6 },
  };

  const $ = (id) => document.getElementById(id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) node.append(c); });
    return node;
  }

  function clock(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /* ---------- State ---------- */
  function load() {
    const data = readJSON(KEY) || {};
    return {
      settings: { style: 'narrator', speed: '1', voiceURI: null, quizMe: true, follow: true, ...(data.settings || {}) },
      progress: data.progress || {},
      lastEpisode: data.lastEpisode || null,
    };
  }
  const state = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* unavailable */ } }

  /* ================= The script writer =================
     Reads a summary's Markdown and writes it the way a calm narrator would say it:
     an introduction, spoken transitions between sections, ordinals for numbered
     lists, room to breathe after key ideas, an optional recall round, and a sign-off. */

  function speakable(s) {
    return String(s)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')             // links -> their text
      .replace(/`([^`]+)`/g, '$1')
      .replace(/(\*\*|==|__)/g, '')
      .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, '$1$2')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\be\.g\.,?/gi, 'for example,')
      .replace(/\bi\.e\.,?/gi, 'that is,')
      .replace(/\betc\./gi, 'and so on.')
      .replace(/\bvs\.?\s/gi, 'versus ')
      .replace(/\s&\s/g, ' and ')
      .replace(/\s*->\s*/g, ' leads to ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const endWithStop = (s) => (/[.!?…:"')\]]$/.test(s) ? s : `${s}.`);

  // Split into sentences, and break very long ones at commas so no single
  // utterance runs long (some browsers cut speech off after ~15 seconds).
  function sentences(text) {
    const parts = (text.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)/g) || [text]).map((s) => s.trim()).filter(Boolean);
    const out = [];
    parts.forEach((p) => {
      if (p.length <= 220) { out.push(p); return; }
      let rest = p;
      while (rest.length > 220) {
        const cut = Math.max(rest.lastIndexOf(', ', 200), rest.lastIndexOf('; ', 200));
        if (cut < 60) break;
        out.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 2).trim();
      }
      if (rest) out.push(rest);
    });
    return out;
  }

  function parseBlocks(md) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    const isStart = (l) => /^(#{1,4}\s|>|```|\s*[-*+]\s+|\s*\d+[.)]\s+|(-{3,}|\*{3,}|_{3,})\s*$)/.test(l);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^```/.test(line)) { i++; while (i < lines.length && !/^```/.test(lines[i])) i++; i++; continue; } // code isn't read aloud
      let m = line.match(/^(#{1,4})\s+(.*)$/);
      if (m) { blocks.push({ type: 'h', level: m[1].length <= 2 ? 2 : 3, text: m[2].replace(/\s+#+\s*$/, '') }); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { i++; continue; }
      if (/^>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        blocks.push({ type: 'quote', text: buf.join(' ') });
        continue;
      }
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      if (ordered || /^\s*[-*+]\s+/.test(line)) {
        const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
        const items = [];
        while (i < lines.length && lines[i].trim()) {
          if (marker.test(lines[i])) items.push(lines[i].replace(marker, ''));
          else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
          else break;
          i++;
        }
        blocks.push({ type: ordered ? 'ol' : 'ul', items });
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isStart(lines[i]))) para.push(lines[i++].trim());
      blocks.push({ type: 'p', text: para.join(' ') });
    }
    return blocks;
  }

  function keyTerm(raw) {
    const m = raw.match(/^\*\*(.+?)\*\*\s*(?::|[-–—]\s)\s*(.+)$/) || raw.match(/^\*\*(.+?):\*\*\s*(.+)$/);
    if (!m) return null;
    const term = speakable(m[1]).replace(/:$/, '');
    const def = speakable(m[2]);
    return term && def ? { term, def } : null;
  }

  // Lowercase the first letter only for everyday words, so names and acronyms
  // ("Krebs cycle", "ATP synthesis") keep their capitals after "Second," etc.
  const COMMON_START = /^(the|a|an|how|why|what|when|where|who|which|our|your|this|that|these|those|its|key|main|some|most|many|each|every|all|first|step|steps|using|use|making|make|understanding|understand|types|kinds|parts|examples|common|basic|read|drill|check|prove|review|write|practice|take|start|try|learn|test|keep|find)\b/i;
  const softLower = (t) => (COMMON_START.test(t) && /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

  const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
  const TRANSITIONS = [
    (t) => `Now, let's turn to ${t}.`,
    (t) => `Which brings us to ${t}.`,
    (t) => `Next, ${t}.`,
    (t) => `Let's talk about ${t}.`,
    (t) => `Now, consider ${t}.`,
  ];

  function sectionIntro(heading, n) {
    const t = speakable(heading);
    if (/big picture|overview|introduction|in brief|tl;?dr/i.test(t)) return 'Let\'s start with the big picture.';
    if (/key terms?|vocabulary|definitions|glossary|terms to know/i.test(t)) return 'Now, a few words worth knowing.';
    if (/takeaway|conclusion|remember|bottom line|wrap|in summary|summary/i.test(t)) return 'And now, the part worth holding on to.';
    if (/main ideas?|key ideas?|key points?/i.test(t)) return 'Here are the main ideas.';
    if (/example/i.test(t)) return 'Let\'s make it concrete, with an example or two.';
    return TRANSITIONS[n % TRANSITIONS.length](softLower(t));
  }

  function writeEpisode(summary, number, quizMe) {
    const title = speakable(String(summary.title || '').replace(/^sample:\s*/i, '')) || 'an untitled summary';
    const segments = [];
    const terms = [];
    let seg = null;
    let transitions = 0;

    const newSeg = (name) => { seg = { title: name, lines: [] }; segments.push(seg); };
    const say = (text, pause = 450, opts = {}) => {
      sentences(endWithStop(speakable(text))).forEach((s, i, arr) => seg.lines.push({ text: s, pause: i === arr.length - 1 ? pause : 280, ...opts }));
    };

    // Introduction
    newSeg('Introduction');
    say('Welcome to The Study Room.', 900);
    say(`This is episode ${number}.`, 500);
    say(`Today, we're going to spend a little time with ${title}.`, 700);
    if (summary.subject) say(`It's part of your work in ${speakable(summary.subject)}.`, 600);
    say('So get comfortable. There\'s no rush.', 900);
    say('Let\'s begin.', 1400);

    const blocks = parseBlocks(summary.body);
    if (!blocks.length) {
      say('Well. It seems this summary is still waiting to be written.', 900);
      say('Come back once there\'s something on the page, and we\'ll go through it together.', 1200);
    }

    blocks.forEach((b) => {
      if (b.type === 'h') {
        newSeg(speakable(b.text));
        if (b.level === 2) say(sectionIntro(b.text, transitions++), 900);
        else say(`${endWithStop(speakable(b.text))}`, 700);
        return;
      }
      if (!seg || seg.title === 'Introduction') newSeg(title);

      if (b.type === 'p') { say(b.text, 800); return; }

      if (b.type === 'quote') {
        say(/worth holding on to/.test(seg.lines[0]?.text || '') ? 'Remember this.' : 'Here\'s something worth remembering.', 700);
        say(b.text, 1500);
        return;
      }

      const items = b.items.map((raw) => ({ raw, kt: keyTerm(raw.replace(/^\s+/, '')) }));
      items.forEach(({ raw, kt }, idx) => {
        if (kt) {
          terms.push(kt);
          say(kt.term, 550);
          say(kt.def, 1100);
          return;
        }
        let text = speakable(raw);
        if (b.type === 'ol') {
          const lead = items.length > 1 && idx === items.length - 1 && idx >= 2 ? 'And finally' : (ORDINALS[idx] || 'Next');
          text = `${lead}, ${softLower(text)}`;
        }
        say(text, b.type === 'ol' ? 850 : 650);
      });
    });

    // Recall round: say the term, leave silence to answer, then reveal.
    if (quizMe && terms.length) {
      newSeg('Recall');
      say('Before we go, let\'s see what stayed with you.', 800);
      say('I\'ll say a term. You tell me what it means. Out loud, if you can.', 900);
      say('Take your time. I\'ll wait.', 1300);
      terms.forEach((t) => {
        say(`${t.term}.`, 5500, { recall: true });
        say(t.def, 1300);
      });
      say(terms.length > 1 ? 'However many you got, that effort is exactly what makes it stick.' : 'That effort, reaching for the answer, is exactly what makes it stick.', 900);
    }

    newSeg('Closing');
    say(`And that's ${title}.`, 800);
    say('You\'ve already done the hardest part, which is showing up.', 800);
    say('When you\'re ready, test yourself with the flashcards or a quiz, while it\'s all still fresh.', 900);
    say('Until next time.', 1200);

    return { segments, terms };
  }

  /* ================= Voices ================= */
  const ui = {
    grid: $('podcast-grid'), unsupported: $('unsupported'), empty: $('no-episodes'), player: $('player'),
    coverEp: $('cover-ep'), title: $('ep-title'), meta: $('ep-meta'),
    track: $('track'), fill: $('track-fill'), marks: $('track-marks'),
    timeNow: $('time-now'), timeLeft: $('time-left'), segName: $('segment-name'),
    play: $('play-btn'), prevSeg: $('prev-seg'), nextSeg: $('next-seg'), backLine: $('back-line'), fwdLine: $('fwd-line'),
    voice: $('voice-select'), speed: $('speed-select'), quiz: $('quiz-toggle'), follow: $('follow-toggle'), sample: $('preview-voice'),
    transcript: $('transcript'), list: $('episode-list'),
  };

  let voices = [];

  // Prefer natural-sounding, lower-register English voices for the narrator.
  function narratorScore(v) {
    let s = 0;
    if (/^en/i.test(v.lang)) s += 20;
    if (/^en-(US|GB)/i.test(v.lang)) s += 3;
    if (/natural|neural|premium|enhanced|online/i.test(v.name)) s += 8;
    if (/\b(male|daniel|alex|fred|david|mark|guy|george|james|arthur|oliver|ryan|thomas|aaron|christopher|eric|roger|steffan|andrew|brian|davis|tony|jason|reed|ralph)\b/i.test(v.name)) s += 6;
    if (/\b(female|samantha|victoria|karen|moira|tessa|zira|susan|hazel|libby|sonia|aria|jenny|emma|michelle|fiona|serena)\b/i.test(v.name)) s -= 2;
    if (/google/i.test(v.name)) s += 1;
    if (/(whisper|bells|bubbles|boing|zarvox|trinoids|cellos|bad news|good news|organ|hysterical|jester|superstar|wobble|albert|bahh)/i.test(v.name)) s -= 50; // novelty voices
    return s;
  }

  function loadVoices() {
    if (!supported) return;
    voices = speechSynthesis.getVoices().slice().sort((a, b) => {
      const ea = /^en/i.test(a.lang) ? 0 : 1;
      const eb = /^en/i.test(b.lang) ? 0 : 1;
      return ea - eb || a.name.localeCompare(b.name);
    });
    if (!voices.length) {
      ui.voice.replaceChildren(h('option', { value: '', text: 'Default voice' }));
      return;
    }
    const best = voices.slice().sort((a, b) => narratorScore(b) - narratorScore(a))[0];
    ui.voice.replaceChildren(
      h('option', { value: '', text: `Automatic (${best.name})` }),
      ...voices.map((v) => h('option', { value: v.voiceURI, text: `${v.name} · ${v.lang}` })),
    );
    ui.voice.value = voices.some((v) => v.voiceURI === state.settings.voiceURI) ? state.settings.voiceURI : '';
  }

  function currentVoice() {
    if (!voices.length) return null;
    const chosen = voices.find((v) => v.voiceURI === state.settings.voiceURI);
    return chosen || voices.slice().sort((a, b) => narratorScore(b) - narratorScore(a))[0];
  }

  function voiceParams() {
    const style = STYLES[state.settings.style] || STYLES.narrator;
    const speed = Number(state.settings.speed) || 1;
    return { pitch: style.pitch, rate: Math.min(2.5, style.rate * speed), pauseScale: style.pauseScale / speed };
  }

  /* ================= Episodes ================= */
  function summaries() {
    const list = ((readJSON(SUMMARY_KEY) || {}).summaries || []).slice();
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return list.map((s, i) => ({ ...s, number: i + 1 }));
  }

  let episodes = [];
  let ep = null;       // current episode { summary, segments, items, durations }
  const player = { index: 0, playing: false, gen: 0, timer: null };

  function buildEpisode(summary) {
    const { segments } = writeEpisode(summary, summary.number, state.settings.quizMe);
    const items = [];
    segments.forEach((sg, si) => sg.lines.forEach((ln) => items.push({ ...ln, seg: si })));
    return { summary, segments, items };
  }

  function itemSeconds(item) {
    const { rate, pauseScale } = voiceParams();
    const words = (item.text.match(/\S+/g) || []).length;
    return words / (WORDS_PER_SECOND * rate) + (item.pause * pauseScale) / 1000;
  }

  function episodeSeconds(e) { return e.items.reduce((t, it) => t + itemSeconds(it), 0); }

  function renderEpisodes() {
    ui.list.replaceChildren(...episodes.slice().reverse().map((s) => {
      const prog = state.progress[s.id];
      const est = Math.max(1, Math.round(episodeSeconds(buildEpisode(s)) / 60));
      const pct = prog ? Math.round((prog.index / Math.max(1, prog.total)) * 100) : 0;
      return h('li', {}, h('button', {
        type: 'button', class: 'episode', 'aria-current': ep && ep.summary.id === s.id ? 'true' : 'false',
        onclick: () => { selectEpisode(s.id); history.replaceState(null, '', `#ep/${s.id}`); },
      },
        h('span', { class: 'ep-num', text: `EP ${s.number}` }),
        h('span', { class: 'ep-body' },
          h('span', { class: 'ep-title', text: s.title || 'Untitled summary' }),
          h('span', { class: 'ep-sub' },
            `${s.subject ? `${s.subject} · ` : ''}~${est} min`,
            prog && prog.done ? h('span', { class: 'ep-done', text: ' · ✓ Listened' }) : null),
          prog && !prog.done && pct > 0 ? h('span', { class: 'ep-progress', 'aria-label': `${pct}% listened` }, h('span', { style: `width:${pct}%` })) : null,
        ),
      ));
    }));
  }

  function selectEpisode(id, { keepPlaying = false } = {}) {
    const s = episodes.find((x) => x.id === id) || episodes[episodes.length - 1];
    if (!s) return;
    const wasPlaying = player.playing && keepPlaying;
    stop();
    ep = buildEpisode(s);
    state.lastEpisode = s.id;
    const prog = state.progress[s.id];
    player.index = prog && !prog.done ? Math.min(prog.index, ep.items.length - 1) : 0;
    save();

    ui.coverEp.textContent = `EP ${s.number}`;
    ui.title.textContent = s.title || 'Untitled summary';
    const mins = Math.max(1, Math.round(episodeSeconds(ep) / 60));
    ui.meta.textContent = [s.subject, `About ${plural(mins, 'minute')}`, player.index ? 'Picking up where you left off' : null].filter(Boolean).join(' · ');
    document.title = `${s.title || 'Untitled summary'} · The Podcast`;

    renderTranscript();
    renderMarks();
    renderEpisodes();
    updatePosition();
    if (wasPlaying) play();
  }

  function renderTranscript() {
    let n = 0;
    ui.transcript.replaceChildren(...ep.segments.map((sg) => h('div', { class: 't-seg' },
      h('h4', { text: sg.title }),
      h('p', {}, sg.lines.map((ln) => {
        const i = n++;
        return [h('span', { class: `line${ln.recall ? ' recall' : ''}`, 'data-i': i, text: ln.text, onclick: () => jump(i) }), ' '];
      })),
    )));
  }

  function renderMarks() {
    const total = episodeSeconds(ep);
    let t = 0;
    let lastSeg = -1;
    const marks = [];
    ep.items.forEach((it) => {
      if (it.seg !== lastSeg && t > 0) marks.push(h('span', { style: `left:${(t / total) * 100}%` }));
      lastSeg = it.seg;
      t += itemSeconds(it);
    });
    ui.marks.replaceChildren(...marks);
  }

  /* ================= Playback ================= */
  function stop() {
    player.gen++;
    clearTimeout(player.timer);
    if (supported) speechSynthesis.cancel();
  }

  function speakCurrent() {
    const gen = ++player.gen;
    const item = ep.items[player.index];
    if (!item) { finish(); return; }
    updatePosition();
    saveProgress();

    const u = new SpeechSynthesisUtterance(item.text);
    const v = currentVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    const { rate, pitch, pauseScale } = voiceParams();
    u.rate = rate;
    u.pitch = pitch;
    const advance = () => {
      if (gen !== player.gen || !player.playing) return;
      player.timer = setTimeout(() => {
        if (gen !== player.gen || !player.playing) return;
        player.index++;
        speakCurrent();
      }, item.pause * pauseScale);
    };
    u.onend = advance;
    u.onerror = (e) => {
      if (gen !== player.gen || e.error === 'interrupted' || e.error === 'canceled') return;
      if (e.error === 'not-allowed') { pause(); return; } // browser wants a click first
      advance();
    };
    speechSynthesis.speak(u);
  }

  function play() {
    if (!ep || !supported) return;
    if (player.index >= ep.items.length) player.index = 0;
    stop();
    player.playing = true;
    setPlayingUI();
    speechSynthesis.resume(); // in case the browser left speech paused
    setTimeout(() => { if (player.playing) speakCurrent(); }, 60);
  }

  function pause() {
    player.playing = false;
    stop();
    setPlayingUI();
    saveProgress();
  }

  function finish() {
    player.playing = false;
    player.index = ep.items.length;
    setPlayingUI();
    state.progress[ep.summary.id] = { index: ep.items.length, total: ep.items.length, done: true, at: new Date().toISOString() };
    save();
    updatePosition();
    renderEpisodes();
    player.index = 0;
  }

  function jump(i) {
    if (!ep) return;
    player.index = Math.max(0, Math.min(ep.items.length - 1, i));
    if (player.playing) { stop(); setTimeout(() => { if (player.playing) speakCurrent(); }, 60); }
    else { updatePosition(); saveProgress(); }
  }

  function segStart(si) { return ep.items.findIndex((it) => it.seg === si); }

  function jumpSection(dir) {
    if (!ep) return;
    const cur = ep.items[Math.min(player.index, ep.items.length - 1)].seg;
    const start = segStart(cur);
    // "Previous" restarts this section unless we're right at its beginning.
    let target = dir < 0 && player.index - start > 1 ? cur : cur + dir;
    target = Math.max(0, Math.min(ep.segments.length - 1, target));
    jump(segStart(target));
  }

  function saveProgress() {
    if (!ep) return;
    const prev = state.progress[ep.summary.id];
    state.progress[ep.summary.id] = { index: player.index, total: ep.items.length, done: prev ? prev.done && player.index === 0 : false, at: new Date().toISOString() };
    save();
  }

  function setPlayingUI() {
    ui.player.classList.toggle('is-playing', player.playing);
    ui.play.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  }

  function updatePosition() {
    if (!ep) return;
    const idx = Math.min(player.index, ep.items.length);
    const total = episodeSeconds(ep);
    const elapsed = ep.items.slice(0, idx).reduce((t, it) => t + itemSeconds(it), 0);
    const pct = total ? (elapsed / total) * 100 : 0;
    ui.fill.style.width = `${pct}%`;
    ui.track.setAttribute('aria-valuenow', String(Math.round(pct)));
    ui.track.setAttribute('aria-valuetext', `${clock(elapsed)} of ${clock(total)}`);
    ui.timeNow.textContent = clock(elapsed);
    ui.timeLeft.textContent = `-${clock(total - elapsed)}`;
    const cur = ep.items[idx];
    ui.segName.textContent = cur ? ep.segments[cur.seg].title : 'The end';

    ui.transcript.querySelectorAll('.line').forEach((el) => {
      const i = Number(el.dataset.i);
      el.classList.toggle('current', i === idx);
      el.classList.toggle('done', i < idx);
    });

    if (state.settings.follow && player.playing) {
      const line = ui.transcript.querySelector('.line.current');
      if (line) {
        const box = ui.transcript;
        const top = line.offsetTop - box.offsetTop;
        if (top < box.scrollTop + 40 || top > box.scrollTop + box.clientHeight - 80) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
      }
    }
  }

  // Click/drag on the track to seek (to the nearest sentence).
  function seekFromEvent(e) {
    const r = ui.track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const target = episodeSeconds(ep) * frac;
    let t = 0;
    let i = 0;
    for (; i < ep.items.length; i++) {
      const d = itemSeconds(ep.items[i]);
      if (t + d / 2 > target) break;
      t += d;
    }
    jump(Math.min(i, ep.items.length - 1));
  }
  ui.track.addEventListener('click', (e) => { if (ep) seekFromEvent(e); });
  ui.track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); jumpSection(e.key === 'ArrowRight' ? 1 : -1); }
  });

  ui.play.addEventListener('click', () => (player.playing ? pause() : play()));
  ui.prevSeg.addEventListener('click', () => jumpSection(-1));
  ui.nextSeg.addEventListener('click', () => jumpSection(1));
  ui.backLine.addEventListener('click', () => jump(player.index - 1));
  ui.fwdLine.addEventListener('click', () => jump(player.index + 1));

  document.addEventListener('keydown', (e) => {
    if (!ep || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === ' ' && !e.target.closest('button, a, summary')) { e.preventDefault(); player.playing ? pause() : play(); }
    else if (e.key === 'ArrowRight' && !e.target.closest('[role="slider"]')) { e.preventDefault(); e.shiftKey ? jumpSection(1) : jump(player.index + 1); }
    else if (e.key === 'ArrowLeft' && !e.target.closest('[role="slider"]')) { e.preventDefault(); e.shiftKey ? jumpSection(-1) : jump(player.index - 1); }
  });

  /* ---------- Settings ---------- */
  function restartLine() {
    renderMarks();
    updatePosition();
    renderEpisodes();
    if (player.playing) jump(player.index);
  }

  document.querySelectorAll('input[name="style"]').forEach((r) => r.addEventListener('change', () => {
    state.settings.style = r.value;
    save();
    restartLine();
  }));

  ui.speed.addEventListener('change', () => { state.settings.speed = ui.speed.value; save(); restartLine(); });
  ui.voice.addEventListener('change', () => { state.settings.voiceURI = ui.voice.value || null; save(); if (player.playing) jump(player.index); });
  ui.follow.addEventListener('change', () => { state.settings.follow = ui.follow.checked; save(); });
  ui.quiz.addEventListener('change', () => {
    state.settings.quizMe = ui.quiz.checked;
    save();
    if (!ep) return;
    // Rebuild the script, staying on the same sentence where possible.
    const currentText = ep.items[player.index]?.text;
    const wasPlaying = player.playing;
    stop();
    ep = buildEpisode(ep.summary);
    const found = ep.items.findIndex((it) => it.text === currentText);
    player.index = found >= 0 ? found : Math.min(player.index, ep.items.length - 1);
    renderTranscript();
    renderMarks();
    renderEpisodes();
    updatePosition();
    if (wasPlaying) { player.playing = true; setTimeout(speakCurrent, 60); }
  });

  ui.sample.addEventListener('click', () => {
    if (!supported) return;
    pause();
    const u = new SpeechSynthesisUtterance('Welcome to The Study Room. Let\'s take our time, and learn something worth keeping.');
    const v = currentVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    const { rate, pitch } = voiceParams();
    u.rate = rate;
    u.pitch = pitch;
    speechSynthesis.speak(u);
  });

  $('to-top').addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // Stop talking if the page is closed or reloaded mid-sentence.
  window.addEventListener('pagehide', () => { if (supported) speechSynthesis.cancel(); });

  /* ================= Start ================= */
  function init() {
    ui.unsupported.hidden = supported;
    episodes = summaries();
    ui.empty.hidden = episodes.length > 0;
    ui.grid.hidden = episodes.length === 0;
    document.querySelector('.shortcuts').hidden = episodes.length === 0;

    const radio = document.querySelector(`input[name="style"][value="${state.settings.style}"]`) || document.querySelector('input[name="style"][value="narrator"]');
    radio.checked = true;
    ui.speed.value = state.settings.speed;
    ui.quiz.checked = state.settings.quizMe;
    ui.follow.checked = state.settings.follow;
    [ui.play, ui.prevSeg, ui.nextSeg, ui.backLine, ui.fwdLine, ui.sample].forEach((b) => { b.disabled = !supported; });

    if (supported) {
      loadVoices();
      speechSynthesis.addEventListener('voiceschanged', () => { loadVoices(); if (ep) { renderMarks(); updatePosition(); } });
    }
    if (!episodes.length) return;

    const fromHash = (location.hash.match(/^#ep\/(.+)$/) || [])[1];
    selectEpisode(decodeURIComponent(fromHash || '') || state.lastEpisode);
  }

  init();
})();

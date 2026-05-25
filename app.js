/* ============================================================
   Permis Bateau — Application de quiz
   ============================================================ */

'use strict';

/* ---------- Catalogue des thèmes ---------- */
const THEMES = {
  'balisage-maritime':   { label: 'Balisage maritime',           permis: ['cotier'] },
  'regles-barre':        { label: 'Règles de barre (RIPAM)',     permis: ['cotier', 'fluvial'] },
  'feux-marques':        { label: 'Feux et marques de navire',   permis: ['cotier', 'fluvial'] },
  'signaux-sonores':     { label: 'Signaux sonores',             permis: ['cotier', 'fluvial'] },
  'securite':            { label: 'Sécurité — Division 240',     permis: ['cotier', 'fluvial'] },
  'vhf-detresse':        { label: 'VHF & procédures de détresse', permis: ['cotier', 'fluvial'] },
  'meteo':               { label: 'Météo marine',                permis: ['cotier'] },
  'marees':              { label: 'Marées & cartes marines',     permis: ['cotier'] },
  'cotier-zones':        { label: 'Zones côtières & bande des 300m', permis: ['cotier'] },
  'signalisation-fluviale': { label: 'Signalisation fluviale',   permis: ['fluvial'] },
  'rpp-fluvial':         { label: 'RPP — Règles de navigation fluviale', permis: ['fluvial'] },
  'ecluses':             { label: 'Écluses & ouvrages',          permis: ['fluvial'] },
  'environnement':       { label: 'Environnement & pollution',   permis: ['cotier', 'fluvial'] },
  'reglementation':      { label: 'Réglementation & documents',  permis: ['cotier', 'fluvial'] },
};

/* ---------- État global ---------- */
const State = {
  current: null,        // session active (objet quiz)
  screen: 'home',
};

/* ---------- Persistance (localStorage) ---------- */
const Storage = {
  KEY: 'permisbateau.v1',
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return this.defaults();
      const data = JSON.parse(raw);
      return { ...this.defaults(), ...data };
    } catch (e) {
      console.warn('Lecture localStorage impossible', e);
      return this.defaults();
    }
  },
  save(data) {
    try { localStorage.setItem(this.KEY, JSON.stringify(data)); }
    catch (e) { console.warn('Écriture localStorage impossible', e); }
  },
  defaults() {
    return {
      questionStats: {},   // { qid: { seen, correct, wrong, lastSeen, dueAt } }
      examHistory: [],     // [ { date, permis, score, total, pass } ]
      sessionsCount: 0,
    };
  },
  reset() { localStorage.removeItem(this.KEY); }
};

let store = Storage.load();

/* ---------- Helpers ---------- */
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function letterOf(i) { return ['A', 'B', 'C', 'D', 'E'][i]; }
function fmtTime(s) {
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
function todayStr() {
  const d = new Date();
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ---------- Sélection des questions ---------- */
function poolFor(permis) {
  // permis : 'cotier' | 'fluvial' | 'tronc-commun' | 'all'
  if (!window.QUESTIONS) return [];
  if (permis === 'all') return window.QUESTIONS.slice();
  if (permis === 'tronc-commun') {
    return window.QUESTIONS.filter(q => q.permis === 'tronc-commun');
  }
  // Côtier = tronc commun + spécifique côtier
  // Fluvial = tronc commun + spécifique fluvial
  return window.QUESTIONS.filter(q => q.permis === 'tronc-commun' || q.permis === permis);
}

function poolByTheme(theme) {
  if (!window.QUESTIONS) return [];
  return window.QUESTIONS.filter(q => q.theme === theme);
}

function pickRandom(pool, n) {
  return shuffle(pool).slice(0, n);
}

/* ---------- Démarrage d'une session ---------- */
function startSession({ mode, permis, theme, count, timed }) {
  let pool;
  if (mode === 'review') {
    pool = mistakesPool();
    if (pool.length === 0) {
      alert('Aucune erreur enregistrée pour l\'instant — fais d\'abord quelques quiz !');
      return;
    }
  } else if (theme) {
    pool = poolByTheme(theme);
  } else {
    pool = poolFor(permis);
  }

  if (pool.length === 0) {
    alert('Pas encore de questions pour cette sélection.');
    return;
  }

  const questions = pickRandom(pool, Math.min(count, pool.length));

  State.current = {
    mode,
    permis,
    theme,
    questions,
    index: 0,
    answers: [],
    startedAt: Date.now(),
    timed: !!timed,
    timeLimit: timed ? 90 * 60 : null,
    timerId: null,
    showExplanations: mode !== 'exam',
  };

  if (timed) startTimer();
  showScreen('quiz');
  renderQuestion();
}

/* ---------- Timer (mode examen) ---------- */
function startTimer() {
  const s = State.current;
  const timerEl = $('#quiz-timer');
  timerEl.classList.remove('hidden');
  const endAt = s.startedAt + s.timeLimit * 1000;
  const tick = () => {
    const remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    timerEl.textContent = `⏱ ${fmtTime(remaining)}`;
    timerEl.classList.toggle('warn', remaining <= 600 && remaining > 120);
    timerEl.classList.toggle('crit', remaining <= 120);
    if (remaining <= 0) {
      clearInterval(s.timerId);
      finishSession(true);
    }
  };
  tick();
  s.timerId = setInterval(tick, 1000);
}
function stopTimer() {
  if (State.current && State.current.timerId) {
    clearInterval(State.current.timerId);
    State.current.timerId = null;
  }
  $('#quiz-timer').classList.add('hidden');
}

/* ---------- Rendu d'une question ---------- */
function renderQuestion() {
  const s = State.current;
  const q = s.questions[s.index];

  // Header
  $('#quiz-progress-text').textContent = `Question ${s.index + 1} / ${s.questions.length}`;
  $('#quiz-progress-fill').style.width = `${((s.index) / s.questions.length) * 100}%`;
  const themeLabel = THEMES[q.theme]?.label ?? q.theme;
  $('#quiz-theme-tag').textContent = themeLabel;

  // Question
  $('#quiz-question-number').textContent = `Question n°${s.index + 1}`;
  $('#quiz-question').textContent = q.question;

  // Choix
  const ul = $('#quiz-choices');
  ul.innerHTML = '';
  // On mélange les choix mais on conserve l'index correct
  const indices = shuffle(q.choices.map((_, i) => i));
  s._currentChoiceMap = indices;     // map[positionAffichée] = indexOriginal
  indices.forEach((origIdx, dispIdx) => {
    const li = document.createElement('li');
    li.dataset.idx = dispIdx;
    li.innerHTML = `
      <span class="choice-letter">${letterOf(dispIdx)}</span>
      <span class="choice-text">${escapeHtml(q.choices[origIdx])}</span>
    `;
    li.addEventListener('click', () => selectChoice(dispIdx));
    ul.appendChild(li);
  });

  s._selected = null;
  $('#quiz-feedback').classList.add('hidden');
  $('#quiz-validate').classList.remove('hidden');
  $('#quiz-validate').disabled = true;
  $('#quiz-next').classList.add('hidden');
  $('#quiz-next').textContent = (s.index === s.questions.length - 1) ? 'Voir mes résultats →' : 'Question suivante →';
}

function selectChoice(dispIdx) {
  const s = State.current;
  if (s._answered) return;
  s._selected = dispIdx;
  $$('#quiz-choices li').forEach(li => li.classList.remove('selected'));
  $$('#quiz-choices li')[dispIdx].classList.add('selected');
  $('#quiz-validate').disabled = false;
}

function validateAnswer() {
  const s = State.current;
  if (s._selected === null) return;
  s._answered = true;

  const q = s.questions[s.index];
  const chosenOrigIdx = s._currentChoiceMap[s._selected];
  const correct = chosenOrigIdx === q.answer;

  // Mémorise la réponse
  s.answers.push({
    qid: q.id,
    theme: q.theme,
    chosen: chosenOrigIdx,
    correct,
  });

  // Stats persistantes
  recordQuestionStat(q.id, correct);

  // Affichage feedback
  const lis = $$('#quiz-choices li');
  lis.forEach(li => li.classList.add('locked'));
  // Trouver la position affichée de la bonne réponse
  const dispCorrect = s._currentChoiceMap.indexOf(q.answer);
  lis[dispCorrect].classList.add('correct');
  if (!correct) lis[s._selected].classList.add('wrong');

  if (s.showExplanations) {
    const fb = $('#quiz-feedback');
    fb.className = 'feedback ' + (correct ? 'good' : 'bad');
    fb.innerHTML = `
      <div class="feedback-title">${correct ? '✓ Bonne réponse !' : '✗ Mauvaise réponse'}</div>
      <div class="feedback-text">${escapeHtml(q.explanation || '')}</div>
      ${q.source ? `<div class="feedback-source">📖 ${escapeHtml(q.source)}</div>` : ''}
    `;
    fb.classList.remove('hidden');
  }

  $('#quiz-validate').classList.add('hidden');
  $('#quiz-next').classList.remove('hidden');
}

function nextQuestion() {
  const s = State.current;
  s._answered = false;
  s._selected = null;
  s.index++;
  if (s.index >= s.questions.length) {
    finishSession(false);
  } else {
    renderQuestion();
  }
}

function quitQuiz() {
  if (!State.current) return showScreen('home');
  if (State.current.answers.length > 0 && State.current.mode === 'exam') {
    if (!confirm('Quitter l\'examen en cours ? Le score ne sera pas enregistré.')) return;
  }
  stopTimer();
  State.current = null;
  showScreen('home');
}

/* ---------- Fin de session / résultats ---------- */
function finishSession(timeout) {
  const s = State.current;
  stopTimer();

  const correctCount = s.answers.filter(a => a.correct).length;
  const total = s.questions.length;

  // Enregistre examen blanc dans l'historique
  // Seuil officiel : 5 erreurs max, soit 35/40 (87,5 %)
  if (s.mode === 'exam') {
    const maxErrors = Math.ceil(total * 5 / 40);
    const pass = ((total - correctCount) <= maxErrors);
    store.examHistory.unshift({
      date: todayStr(),
      permis: s.permis,
      score: correctCount,
      total,
      pass,
      timeout: !!timeout,
    });
    if (store.examHistory.length > 50) store.examHistory.pop();
    Storage.save(store);
  }

  // Affichage écran résultats
  $('#results-score-num').textContent = correctCount;
  $('#results-score-total').textContent = total;

  let title, subtitle, medal;
  const pct = correctCount / total;
  if (s.mode === 'exam') {
    const errors = total - correctCount;
    const maxErrors = Math.ceil(total * 5 / 40);
    const passed = errors <= maxErrors;
    title = passed ? 'Examen réussi !' : 'Pas tout à fait...';
    medal = passed ? '🏆' : '🌊';
    subtitle = passed
      ? `${errors} erreur(s) — tu es dans les ${maxErrors} admises. Continue comme ça !`
      : `${errors} erreur(s) — il faut ${maxErrors} maximum pour valider. Encore un peu de travail.`;
    if (timeout) subtitle = '⏰ Temps écoulé. ' + subtitle;
  } else {
    if (pct >= 0.9) { title = 'Excellent !'; medal = '🥇'; subtitle = 'Maîtrise solide.'; }
    else if (pct >= 0.75) { title = 'Très bien.'; medal = '🥈'; subtitle = 'Encore quelques détails à peaufiner.'; }
    else if (pct >= 0.5) { title = 'Pas mal.'; medal = '🥉'; subtitle = 'Continue, tu progresses.'; }
    else { title = 'À retravailler.'; medal = '🧭'; subtitle = 'Repasse ces questions en mode apprentissage.'; }
  }
  $('#results-title').textContent = title;
  $('#results-subtitle').textContent = subtitle;
  $('#results-medal').textContent = medal;

  // Détail par thème
  const byTheme = {};
  s.answers.forEach(a => {
    if (!byTheme[a.theme]) byTheme[a.theme] = { total: 0, correct: 0 };
    byTheme[a.theme].total++;
    if (a.correct) byTheme[a.theme].correct++;
  });
  const bd = $('#results-breakdown');
  bd.innerHTML = '';
  Object.entries(byTheme).forEach(([t, v]) => {
    const label = THEMES[t]?.label ?? t;
    const div = document.createElement('div');
    div.className = 'bd-item';
    div.innerHTML = `
      <div class="bd-theme">${label}</div>
      <div class="bd-score">${v.correct} / ${v.total}</div>
    `;
    bd.appendChild(div);
  });

  // Bouton "revoir mes erreurs" : seulement s'il y en a
  const hasMistakes = s.answers.some(a => !a.correct);
  $('#review-mistakes-btn').classList.toggle('hidden', !hasMistakes);

  // Sauve la session
  store.sessionsCount++;
  Storage.save(store);

  showScreen('results');
}

/* ---------- Système d'erreurs / répétition espacée ---------- */
function recordQuestionStat(qid, correct) {
  const now = Date.now();
  const day = 86400000;
  if (!store.questionStats[qid]) {
    store.questionStats[qid] = { seen: 0, correct: 0, wrong: 0, lastSeen: 0, dueAt: 0 };
  }
  const s = store.questionStats[qid];
  s.seen++;
  s.lastSeen = now;
  if (correct) {
    s.correct++;
    // Espacement progressif : 1j, 3j, 7j, 14j, 30j
    const streak = s.correct - s.wrong;
    const interval = streak <= 0 ? 1 : [1, 3, 7, 14, 30][Math.min(4, streak - 1)];
    s.dueAt = now + interval * day;
  } else {
    s.wrong++;
    s.dueAt = now + 1 * day;
  }
  Storage.save(store);
}

function mistakesPool() {
  // Questions qui ont été ratées au moins une fois et qui ne sont pas dans la "période d'attente"
  const now = Date.now();
  const ids = Object.entries(store.questionStats)
    .filter(([, v]) => v.wrong > 0 && v.dueAt <= now + 86400000) // dues sous 24h
    .map(([id]) => id);
  return window.QUESTIONS.filter(q => ids.includes(q.id));
}

function updateMistakesCounter() {
  const n = mistakesPool().length;
  const el = $('#review-count-info');
  if (n === 0) el.textContent = 'Aucune erreur enregistrée — bravo ou… il faut commencer !';
  else el.textContent = `${n} question(s) à revoir`;
}

/* ---------- Stats ---------- */
function renderStats() {
  const ids = Object.keys(store.questionStats);
  let total = 0, correct = 0;
  const byTheme = {};

  ids.forEach(id => {
    const s = store.questionStats[id];
    const q = window.QUESTIONS.find(x => x.id === id);
    if (!q) return;
    total += s.seen;
    correct += s.correct;
    if (!byTheme[q.theme]) byTheme[q.theme] = { seen: 0, correct: 0 };
    byTheme[q.theme].seen += s.seen;
    byTheme[q.theme].correct += s.correct;
  });

  $('#stat-total-q').textContent = total;
  $('#stat-accuracy').textContent = total === 0 ? '—' : `${Math.round((correct / total) * 100)}%`;
  $('#stat-exams').textContent = store.examHistory.length;
  const bestExam = store.examHistory.reduce((b, e) => Math.max(b, e.score / e.total), 0);
  $('#stat-best').textContent = store.examHistory.length === 0 ? '—' :
    `${store.examHistory.reduce((b, e) => e.score / e.total > b.score / b.total ? e : b).score} / ${store.examHistory.reduce((b, e) => e.score / e.total > b.score / b.total ? e : b).total}`;

  // Par thème
  const tdiv = $('#stat-by-theme');
  tdiv.innerHTML = '';
  Object.entries(THEMES).forEach(([key, t]) => {
    const v = byTheme[key];
    const seen = v?.seen || 0;
    const pct = seen === 0 ? 0 : Math.round((v.correct / v.seen) * 100);
    const row = document.createElement('div');
    row.className = 'theme-row';
    row.innerHTML = `
      <div class="tname">${t.label}</div>
      <div class="tbar-wrap"><div class="tbar" style="width:${pct}%"></div></div>
      <div class="tnum">${seen === 0 ? '—' : pct + '%'} (${v?.correct || 0}/${seen})</div>
    `;
    tdiv.appendChild(row);
  });

  // Historique examens
  const tb = $('#stat-exam-history');
  tb.innerHTML = '';
  if (store.examHistory.length === 0) {
    tb.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;padding:18px">Aucun examen blanc pour l\'instant.</td></tr>';
  } else {
    store.examHistory.slice(0, 20).forEach(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${e.date}</td>
        <td>${e.permis === 'cotier' ? 'Côtier' : 'Fluvial'}</td>
        <td>${e.score} / ${e.total}</td>
        <td class="${e.pass ? 'pass' : 'fail'}">${e.pass ? '✓ Réussi' : '✗ Échec'}${e.timeout ? ' (timeout)' : ''}</td>
      `;
      tb.appendChild(tr);
    });
  }
}

/* ---------- Navigation entre écrans ---------- */
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  State.screen = id;
  if (id === 'stats') renderStats();
  if (id === 'home') updateMistakesCounter();
  window.scrollTo(0, 0);
}

/* ---------- Sécurité HTML ---------- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- Initialisation ---------- */
function populateThemeSelect() {
  const sel = $('#theme-select');
  sel.innerHTML = '';
  Object.entries(THEMES).forEach(([key, t]) => {
    const opt = document.createElement('option');
    opt.value = key;
    const tag = t.permis.includes('cotier') && t.permis.includes('fluvial') ? ' (tronc commun)'
      : t.permis.includes('cotier') ? ' (côtier)' : ' (fluvial)';
    opt.textContent = t.label + tag;
    sel.appendChild(opt);
  });
}

function bindUI() {
  // Navigation
  $$('.nav-btn').forEach(b => {
    b.addEventListener('click', () => showScreen(b.dataset.screen));
  });

  // Actions des cartes
  document.body.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    switch (a) {
      case 'start-exam': {
        const permis = $('input[name="exam-permit"]:checked').value;
        startSession({ mode: 'exam', permis, count: 40, timed: true });
        break;
      }
      case 'start-theme': {
        const theme = $('#theme-select').value;
        const count = parseInt($('#theme-count').value, 10);
        // Le thème indique de manière implicite le permis (juste pour l'affichage)
        const permis = THEMES[theme].permis[0];
        startSession({ mode: 'theme', permis, theme, count, timed: false });
        break;
      }
      case 'start-learn': {
        const permis = $('input[name="learn-permit"]:checked').value;
        startSession({ mode: 'learn', permis, count: 20, timed: false });
        break;
      }
      case 'start-review': {
        startSession({ mode: 'review', permis: 'all', count: 30, timed: false });
        break;
      }
      case 'validate-answer': validateAnswer(); break;
      case 'next-question': nextQuestion(); break;
      case 'quit-quiz': quitQuiz(); break;
      case 'go-home': showScreen('home'); break;
      case 'restart-same': {
        const s = State.current;
        if (s) startSession({ mode: s.mode, permis: s.permis, theme: s.theme, count: s.questions.length, timed: s.timed });
        break;
      }
      case 'review-mistakes': {
        startSession({ mode: 'review', permis: 'all', count: 30, timed: false });
        break;
      }
      case 'reset-stats': {
        if (confirm('Réinitialiser toute ta progression ? Cette action est irréversible.')) {
          Storage.reset();
          store = Storage.load();
          renderStats();
          updateMistakesCounter();
        }
        break;
      }
    }
  });

  // Raccourcis clavier dans le quiz
  document.addEventListener('keydown', e => {
    if (State.screen !== 'quiz') return;
    const s = State.current;
    if (!s) return;
    if (/^[a-eA-E]$/.test(e.key)) {
      const idx = e.key.toLowerCase().charCodeAt(0) - 97;
      if (idx < s.questions[s.index].choices.length && !s._answered) {
        selectChoice(idx);
      }
    } else if (e.key === 'Enter') {
      if (!s._answered && s._selected !== null) validateAnswer();
      else if (s._answered) nextQuestion();
    }
  });
}

/* ---------- Démarrage ---------- */
window.addEventListener('DOMContentLoaded', () => {
  if (!window.QUESTIONS || window.QUESTIONS.length === 0) {
    document.body.innerHTML = `
      <div style="padding:40px;text-align:center;font-family:sans-serif;">
        <h2>⚠ Base de questions absente</h2>
        <p>Le fichier <code>data/questions.js</code> n'a pas été chargé.</p>
      </div>`;
    return;
  }
  populateThemeSelect();
  bindUI();
  updateMistakesCounter();
  showScreen('home');
});

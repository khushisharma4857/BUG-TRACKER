// ============================================================
// BUG BASH ARENA — core engine
// ============================================================

const SEVERITY = {
  critical: { points: 50, color: '#ff3b5c', label: 'critical', icon: 'ti-skull' },
  high:     { points: 25, color: '#ffa63d', label: 'high',     icon: 'ti-flame' },
  medium:   { points: 10, color: '#3dc9ff', label: 'medium',   icon: 'ti-alert-triangle' },
  low:      { points: 5,  color: '#7a8699', label: 'low',      icon: 'ti-info-circle' }
};

const STORAGE_KEY = 'bugbash_arena_state_v1';
const COMBO_WINDOW_MS = 90 * 1000; // 90s window to keep a streak alive

const ACHIEVEMENT_DEFS = [
  { id: 'first_blood',   title: 'first blood',        desc: 'log the first bug of the session', icon: 'ti-target' },
  { id: 'crit_hunter',   title: 'critical hunter',    desc: 'log 3 critical bugs',               icon: 'ti-skull' },
  { id: 'combo_5',       title: 'on a roll',          desc: 'reach a 5x combo',                  icon: 'ti-bolt' },
  { id: 'combo_10',      title: 'unstoppable',        desc: 'reach a 10x combo',                 icon: 'ti-flame' },
  { id: 'ten_bugs',      title: 'double digits',      desc: 'log 10 bugs in one session',        icon: 'ti-bug' },
  { id: 'three_hunters', title: 'full squad',         desc: 'get 3 different hunters logging',   icon: 'ti-users' },
  { id: 'module_sweep',  title: 'module sweep',       desc: 'log bugs across 4+ different modules', icon: 'ti-grid-dots' }
];

let state = {
  bugs: [],
  hunters: {},      // name -> { score, count, bySeverity:{}, lastLogTime, comboCount, modules:Set-as-array }
  startedAt: Date.now(),
  unlockedAchievements: [],
  soundOn: true,
  round: { active: false, endsAt: 0, durationMs: 0 },
  boss: { active: false, spawnedAt: 0, expiresAt: 0 }
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = parsed;
      if (state.soundOn === undefined) state.soundOn = true;
      if (!state.round) state.round = { active: false, endsAt: 0, durationMs: 0 };
      if (!state.boss) state.boss = { active: false, spawnedAt: 0, expiresAt: 0 };
    }
  } catch (e) {
    console.warn('Could not load saved state, starting fresh.', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save state.', e);
  }
}

function ensureHunter(name) {
  if (!state.hunters[name]) {
    state.hunters[name] = {
      score: 0,
      count: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      lastLogTime: 0,
      comboCount: 0,
      maxCombo: 0,
      modules: []
    };
  }
  return state.hunters[name];
}

function addBug({ hunter, title, severity, module, notes, isBossKill }) {
  const h = ensureHunter(hunter);
  const now = Date.now();

  // combo logic: if within window of their own last log, increase combo
  if (now - h.lastLogTime <= COMBO_WINDOW_MS && h.lastLogTime !== 0) {
    h.comboCount += 1;
  } else {
    h.comboCount = 1;
  }
  h.maxCombo = Math.max(h.maxCombo, h.comboCount);
  h.lastLogTime = now;

  const sevInfo = SEVERITY[severity];
  let points = sevInfo.points;
  // combo multiplier kicks in at 3x+: +10% per combo step beyond 2, capped reasonably
  const comboBonus = h.comboCount >= 3 ? Math.min((h.comboCount - 2) * 0.1, 1.0) : 0;
  let finalPoints = Math.round(points * (1 + comboBonus));

  let bossKill = false;
  if (isBossKill && state.boss.active) {
    finalPoints = finalPoints * 3;
    bossKill = true;
    state.boss = { active: false, spawnedAt: 0, expiresAt: 0 };
  }

  h.score += finalPoints;
  h.count += 1;
  h.bySeverity[severity] += 1;
  if (module && !h.modules.includes(module)) h.modules.push(module);

  const bug = {
    id: 'bug_' + now + '_' + Math.random().toString(36).slice(2, 7),
    hunter, title, severity, module: module || 'general', notes: notes || '',
    points: finalPoints, comboAtLog: h.comboCount, timestamp: now, bossKill
  };

  state.bugs.push(bug);
  saveState();
  return bug;
}

function getLeaderboard() {
  return Object.entries(state.hunters)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.score - a.score);
}

function getGlobalSeverityCounts() {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  state.bugs.forEach(b => counts[b.severity]++);
  return counts;
}

function getGlobalScore() {
  return state.bugs.reduce((sum, b) => sum + b.points, 0);
}

function checkAchievements() {
  const unlocked = new Set(state.unlockedAchievements);
  const counts = getGlobalSeverityCounts();
  const totalBugs = state.bugs.length;
  const hunterCount = Object.keys(state.hunters).length;
  const maxComboOverall = Math.max(0, ...Object.values(state.hunters).map(h => h.maxCombo));
  const allModules = new Set();
  state.bugs.forEach(b => allModules.add(b.module));

  if (totalBugs >= 1) unlocked.add('first_blood');
  if (counts.critical >= 3) unlocked.add('crit_hunter');
  if (maxComboOverall >= 5) unlocked.add('combo_5');
  if (maxComboOverall >= 10) unlocked.add('combo_10');
  if (totalBugs >= 10) unlocked.add('ten_bugs');
  if (hunterCount >= 3) unlocked.add('three_hunters');
  if (allModules.size >= 4) unlocked.add('module_sweep');

  const newlyUnlocked = [...unlocked].filter(id => !state.unlockedAchievements.includes(id));
  state.unlockedAchievements = [...unlocked];
  return newlyUnlocked;
}

// ============================================================
// RENDERING
// ============================================================

function formatClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function renderClock() {
  const el = document.getElementById('sessionClock');
  el.textContent = formatClock(Date.now() - state.startedAt);
}

function renderStatusStrip() {
  document.getElementById('totalBugsStrip').textContent = `${state.bugs.length} bug${state.bugs.length === 1 ? '' : 's'} logged`;
  const lb = getLeaderboard();
  document.getElementById('topHunterStrip').textContent = lb.length
    ? `top hunter: ${lb[0].name} (${lb[0].score} pts)`
    : 'no hunters yet';
  const hottestCombo = lb.reduce((max, h) => Math.max(max, h.comboCount), 0);
  const hottestHunter = lb.find(h => h.comboCount === hottestCombo);
  document.getElementById('streakStrip').textContent = hottestCombo >= 2 && hottestHunter
    ? `${hottestHunter.name} on a ${hottestHunter.comboCount}x streak`
    : 'no active streak';
}

function renderMvpSlot() {
  const lb = getLeaderboard();
  const slot = document.getElementById('mvpSlot');
  if (lb.length === 0) { slot.style.display = 'none'; return; }
  slot.style.display = 'flex';
  document.getElementById('mvpName').textContent = lb[0].name;
}

function renderLeaderboard() {
  const list = document.getElementById('leaderboardList');
  const lb = getLeaderboard();
  document.getElementById('hunterCount').textContent = `${lb.length} hunter${lb.length === 1 ? '' : 's'}`;
  renderMvpSlot();

  if (lb.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-ghost-2"></i>
        <p>no hunters on the board yet</p>
        <span>log the first bug to start the chase</span>
      </div>`;
    return;
  }

  list.innerHTML = lb.map((h, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : '';
    const rankDisplay = rank === 1 ? '#1' : rank === 2 ? '#2' : rank === 3 ? '#3' : `#${rank}`;
    return `
      <div class="hunter-row ${rankClass}">
        <div class="hunter-rank">${rankDisplay}</div>
        <div class="hunter-info">
          <div class="hunter-name">${escapeHtml(h.name)}</div>
          <div class="hunter-meta">${h.count} bug${h.count === 1 ? '' : 's'} ${h.comboCount >= 2 ? `&middot; ${h.comboCount}x combo` : ''}</div>
        </div>
        <div class="hunter-score">${h.score}</div>
      </div>`;
  }).join('');
}

function renderRadar() {
  const svg = document.getElementById('radarSvg');
  const counts = getGlobalSeverityCounts();
  const total = state.bugs.length;
  document.getElementById('radarTotal').textContent = `${total} total`;
  document.getElementById('globalScore').textContent = getGlobalScore();

  const cx = 200, cy = 200, maxR = 150;
  const sevKeys = ['critical', 'high', 'medium', 'low'];
  const maxCount = Math.max(1, ...sevKeys.map(k => counts[k]));

  let svgContent = '';

  // concentric grid rings
  for (let ring = 1; ring <= 4; ring++) {
    const r = (maxR / 4) * ring;
    svgContent += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#262a34" stroke-width="1" />`;
  }

  // axis lines (4 axes for 4 severities)
  const angleStep = (Math.PI * 2) / sevKeys.length;
  sevKeys.forEach((key, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const x2 = cx + maxR * Math.cos(angle);
    const y2 = cy + maxR * Math.sin(angle);
    svgContent += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#262a34" stroke-width="1" />`;
  });

  // data polygon
  let points = [];
  sevKeys.forEach((key, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const value = counts[key] / maxCount;
    const r = value * maxR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x},${y}`);
  });

  svgContent += `<polygon points="${points.join(' ')}" fill="rgba(200,255,61,0.08)" stroke="#c8ff3d" stroke-width="2" stroke-linejoin="round" />`;

  // pulsing nodes at each vertex, colored by severity
  sevKeys.forEach((key, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const value = counts[key] / maxCount;
    const r = value * maxR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    const color = SEVERITY[key].color;
    svgContent += `<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#0a0b0e" stroke-width="2">
      ${counts[key] > 0 ? `<animate attributeName="r" values="5;7;5" dur="1.8s" repeatCount="indefinite" />` : ''}
    </circle>`;

    // label
    const labelR = maxR + 26;
    const lx = cx + labelR * Math.cos(angle);
    const ly = cy + labelR * Math.sin(angle);
    svgContent += `<text x="${lx}" y="${ly}" fill="${color}" font-size="11" font-family="Space Mono, monospace" text-anchor="middle" dominant-baseline="middle">${key} (${counts[key]})</text>`;
  });

  svg.innerHTML = svgContent;
}

function renderLegend() {
  const legend = document.getElementById('severityLegend');
  legend.innerHTML = Object.entries(SEVERITY).map(([key, info]) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${info.color}"></span>
      <span>${info.label} &middot; ${info.points}pt</span>
    </div>
  `).join('');
}

function renderBreakdown() {
  const counts = getGlobalSeverityCounts();
  const total = Math.max(1, state.bugs.length);
  const container = document.getElementById('breakdownBars');
  container.innerHTML = Object.entries(SEVERITY).map(([key, info]) => {
    const count = counts[key];
    const pct = Math.round((count / total) * 100);
    return `
      <div class="bar-row">
        <div class="bar-label">${info.label}</div>
        <div class="bar-track"><div class="bar-fill fill-${key}" style="width:${pct}%"></div></div>
        <div class="bar-count">${count}</div>
      </div>`;
  }).join('');
}

let feedSearchTerm = '';
let feedSeverityFilter = 'all';

function getFilteredBugs() {
  return [...state.bugs].reverse().filter(bug => {
    if (feedSeverityFilter !== 'all' && bug.severity !== feedSeverityFilter) return false;
    if (feedSearchTerm) {
      const haystack = `${bug.title} ${bug.module} ${bug.hunter} ${bug.notes}`.toLowerCase();
      if (!haystack.includes(feedSearchTerm.toLowerCase())) return false;
    }
    return true;
  });
}

function renderActivityFeed() {
  const feed = document.getElementById('activityFeed');
  const filtered = getFilteredBugs();
  const recent = filtered.slice(0, 12);

  if (recent.length === 0) {
    feed.innerHTML = `<div class="empty-state small"><p>${state.bugs.length === 0 ? 'the war room is quiet. log a bug to break the silence.' : 'no bugs match that search/filter.'}</p></div>`;
    return;
  }

  feed.innerHTML = recent.map(bug => {
    const info = SEVERITY[bug.severity];
    const timeAgo = formatTimeAgo(bug.timestamp);
    const comboNote = bug.comboAtLog >= 3 ? ` <b>+${Math.round(((bug.points / info.points) - 1) * 100)}% combo bonus</b>` : '';
    const bossNote = bug.bossKill ? `<span class="boss-badge"><i class="ti ti-skull-bolt"></i> boss kill</span>` : '';
    return `
      <div class="feed-item feed-${bug.severity} ${bug.bossKill ? 'feed-boss' : ''}" data-bug-id="${bug.id}">
        <i class="ti ${info.icon} feed-icon"></i>
        <div class="feed-text"><b>${escapeHtml(bug.hunter)}</b> found a ${info.label} bug in <b>${escapeHtml(bug.module)}</b> &middot; "${escapeHtml(truncate(bug.title, 48))}" &middot; +${bug.points}pts${comboNote}${bossNote}</div>
        <div class="feed-time">${timeAgo}</div>
      </div>`;
  }).join('');

  feed.querySelectorAll('.feed-item').forEach(el => {
    el.addEventListener('click', () => openDetailModal(el.dataset.bugId));
  });
}

document.getElementById('feedSearch').addEventListener('input', (e) => {
  feedSearchTerm = e.target.value;
  renderActivityFeed();
});

document.getElementById('feedFilter').addEventListener('change', (e) => {
  feedSeverityFilter = e.target.value;
  renderActivityFeed();
});

function openDetailModal(bugId) {
  const bug = state.bugs.find(b => b.id === bugId);
  if (!bug) return;
  const info = SEVERITY[bug.severity];
  const body = document.getElementById('detailBody');
  body.innerHTML = `
    <div class="detail-row"><span>title</span><span>${escapeHtml(bug.title)}</span></div>
    <div class="detail-row"><span>hunter</span><span>${escapeHtml(bug.hunter)}</span></div>
    <div class="detail-row"><span>severity</span><span style="color:${info.color}">${info.label}${bug.bossKill ? ' (boss kill)' : ''}</span></div>
    <div class="detail-row"><span>module</span><span>${escapeHtml(bug.module)}</span></div>
    <div class="detail-row"><span>points awarded</span><span>${bug.points}</span></div>
    <div class="detail-row"><span>combo at log time</span><span>${bug.comboAtLog}x</span></div>
    <div class="detail-row"><span>logged</span><span>${new Date(bug.timestamp).toLocaleString()}</span></div>
    ${bug.notes ? `<div class="detail-notes">${escapeHtml(bug.notes)}</div>` : ''}
  `;
  document.getElementById('detailBackdrop').classList.add('open');
}

document.getElementById('detailClose').addEventListener('click', () => {
  document.getElementById('detailBackdrop').classList.remove('open');
});
document.getElementById('detailBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'detailBackdrop') document.getElementById('detailBackdrop').classList.remove('open');
});

function renderComboMeter() {
  const lb = getLeaderboard();
  const flame = document.getElementById('comboFlame');
  const caption = document.getElementById('comboCaption');
  const countEl = document.getElementById('comboCount');

  // active combos = within window
  const now = Date.now();
  const active = lb.filter(h => h.comboCount >= 2 && (now - h.lastLogTime) <= COMBO_WINDOW_MS);
  const best = active.sort((a, b) => b.comboCount - a.comboCount)[0];

  flame.classList.remove('combo-hot', 'combo-blazing');

  if (!best) {
    countEl.textContent = '0';
    caption.textContent = 'no streak. find a critical to ignite one.';
    return;
  }

  countEl.textContent = best.comboCount;
  if (best.comboCount >= 8) {
    flame.classList.add('combo-blazing');
    caption.textContent = `${best.name} is BLAZING. ${best.comboCount} bugs back to back.`;
  } else if (best.comboCount >= 4) {
    flame.classList.add('combo-hot');
    caption.textContent = `${best.name} is heating up with a ${best.comboCount}x streak.`;
  } else {
    caption.textContent = `${best.name} has a ${best.comboCount}x streak going.`;
  }
}

function renderAchievements() {
  const container = document.getElementById('achievements');
  container.innerHTML = ACHIEVEMENT_DEFS.map(a => {
    const unlocked = state.unlockedAchievements.includes(a.id);
    return `
      <div class="achv-row ${unlocked ? 'unlocked' : ''}">
        <i class="ti ${a.icon} achv-icon"></i>
        <div class="achv-text">
          <div class="achv-title">${a.title}</div>
          <div class="achv-desc">${a.desc}</div>
        </div>
      </div>`;
  }).join('');
}

function renderQuickHunters() {
  const container = document.getElementById('quickHunters');
  const names = Object.keys(state.hunters);
  if (names.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = names.map(n => `<span class="quick-hunter-chip" data-name="${escapeHtml(n)}">${escapeHtml(n)}</span>`).join('');
  container.querySelectorAll('.quick-hunter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('hunterName').value = chip.dataset.name;
    });
  });
}

function renderAll() {
  renderStatusStrip();
  renderLeaderboard();
  renderRadar();
  renderLegend();
  renderBreakdown();
  renderActivityFeed();
  renderComboMeter();
  renderAchievements();
  renderRoundUI();
  renderBossBanner();
}

// ============================================================
// SOUND ENGINE (Web Audio, no files)
// ============================================================

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.15) {
  if (!state.soundOn) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* audio not available, fail silently */ }
}

function playBugSound(severity) {
  if (severity === 'critical') { playTone(220, 0.15, 'sawtooth', 0.12); setTimeout(() => playTone(160, 0.2, 'sawtooth', 0.12), 100); }
  else if (severity === 'high') playTone(330, 0.15, 'triangle', 0.12);
  else if (severity === 'medium') playTone(440, 0.1, 'sine', 0.1);
  else playTone(520, 0.08, 'sine', 0.08);
}

function playAchievementSound() {
  [523, 659, 784].forEach((f, i) => setTimeout(() => playTone(f, 0.25, 'triangle', 0.13), i * 110));
}

function playBossSound() {
  [110, 130, 110, 95].forEach((f, i) => setTimeout(() => playTone(f, 0.3, 'sawtooth', 0.15), i * 150));
}

function playBossKillSound() {
  [659, 784, 988, 1318].forEach((f, i) => setTimeout(() => playTone(f, 0.2, 'triangle', 0.14), i * 90));
}

// ============================================================
// CONFETTI
// ============================================================

function fireConfetti() {
  const layer = document.getElementById('confettiLayer');
  const colors = ['#c8ff3d', '#ff3b5c', '#ffa63d', '#3dc9ff'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2 + Math.random() * 1.5) + 's';
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

// ============================================================
// ROUND TIMER
// ============================================================

function startRound(minutes) {
  const durationMs = minutes * 60 * 1000;
  state.round = { active: true, endsAt: Date.now() + durationMs, durationMs };
  saveState();
  renderRoundUI();
  showToast(`<i class="ti ti-player-play"></i> round started &middot; <b>${minutes} min</b> on the clock`, null);
}

function endRound() {
  state.round = { active: false, endsAt: 0, durationMs: 0 };
  saveState();
  renderRoundUI();
  showToast(`<i class="ti ti-flag"></i> round ended. nice work, hunters.`, null);
  playAchievementSound();
}

function renderRoundUI() {
  const label = document.getElementById('roundLabel');
  const clock = document.getElementById('roundClock');
  const btn = document.getElementById('roundBtn');

  if (!state.round.active) {
    label.textContent = 'no round running';
    clock.textContent = '--:--';
    clock.classList.remove('round-urgent');
    btn.innerHTML = '<i class="ti ti-player-play"></i> start round';
    return;
  }

  const remaining = Math.max(0, state.round.endsAt - Date.now());
  const totalSec = Math.floor(remaining / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  label.textContent = 'round in progress';
  clock.textContent = `${m}:${s}`;
  clock.classList.toggle('round-urgent', totalSec <= 30);
  btn.innerHTML = '<i class="ti ti-player-stop"></i> end round';

  if (remaining <= 0) endRound();
}

document.getElementById('roundBtn').addEventListener('click', () => {
  if (state.round.active) {
    endRound();
  } else {
    const input = prompt('Round length in minutes:', '10');
    const minutes = parseFloat(input);
    if (minutes && minutes > 0) startRound(minutes);
  }
});

// ============================================================
// BOSS BUGS
// ============================================================

const BOSS_NAMES = [
  'the checkout crasher', 'the infinite spinner', 'the null pointer hydra',
  'the session ghost', 'the race condition wraith', 'the memory leak leviathan',
  'the off-by-one demon', 'the zombie thread'
];

function maybeSpawnBoss() {
  if (state.boss.active) return;
  if (state.bugs.length < 3) return; // need some warmup activity first
  // ~12% chance per check when conditions are met
  if (Math.random() > 0.12) return;

  const name = BOSS_NAMES[Math.floor(Math.random() * BOSS_NAMES.length)];
  state.boss = { active: true, name, spawnedAt: Date.now(), expiresAt: Date.now() + 90 * 1000 };
  saveState();
  renderBossBanner();
  playBossSound();
  showToast(`<i class="ti ti-skull-bolt"></i> <b>${name}</b> has spawned. log a critical or high bug to slay it for 3x points.`, 'critical');
}

function renderBossBanner() {
  const banner = document.getElementById('bossBanner');
  const text = document.getElementById('bossBannerText');
  const wrap = document.getElementById('bossToggleWrap');

  if (!state.boss.active) {
    banner.style.display = 'none';
    wrap.style.display = 'none';
    return;
  }

  const remaining = Math.max(0, state.boss.expiresAt - Date.now());
  if (remaining <= 0) {
    state.boss = { active: false, spawnedAt: 0, expiresAt: 0 };
    saveState();
    banner.style.display = 'none';
    wrap.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  text.textContent = `${state.boss.name} is loose in the arena`;
  document.getElementById('bossTimer').textContent = `${Math.ceil(remaining / 1000)}s`;
  wrap.style.display = 'flex';
}


// ============================================================
// EXPORT + REPORT
// ============================================================

function exportCsv() {
  if (state.bugs.length === 0) {
    showToast('no bugs to export yet', null);
    return;
  }
  const headers = ['hunter', 'title', 'severity', 'module', 'points', 'combo_at_log', 'boss_kill', 'notes', 'timestamp'];
  const rows = state.bugs.map(b => [
    b.hunter, b.title, b.severity, b.module, b.points, b.comboAtLog,
    b.bossKill ? 'yes' : 'no', (b.notes || '').replace(/\n/g, ' '), new Date(b.timestamp).toISOString()
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bugbash-session-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('<i class="ti ti-download"></i> CSV exported', null);
}

function renderReport() {
  const lb = getLeaderboard();
  const counts = getGlobalSeverityCounts();
  const totalScore = getGlobalScore();
  const moduleCounts = {};
  state.bugs.forEach(b => { moduleCounts[b.module] = (moduleCounts[b.module] || 0) + 1; });
  const sortedModules = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]);
  const duration = formatClock(Date.now() - state.startedAt);

  const body = document.getElementById('reportBody');
  body.innerHTML = `
    <div class="report-grid">
      <div class="report-stat"><div class="stat-value">${state.bugs.length}</div><div class="stat-label">bugs logged</div></div>
      <div class="report-stat"><div class="stat-value">${totalScore}</div><div class="stat-label">arena score</div></div>
      <div class="report-stat"><div class="stat-value">${lb.length}</div><div class="stat-label">hunters</div></div>
      <div class="report-stat"><div class="stat-value">${duration}</div><div class="stat-label">session time</div></div>
    </div>

    <div class="report-section-title">severity split</div>
    <table class="report-table">
      <tr><th>severity</th><th>count</th><th>share</th></tr>
      ${Object.entries(SEVERITY).map(([key, info]) => {
        const c = counts[key];
        const pct = state.bugs.length ? Math.round((c / state.bugs.length) * 100) : 0;
        return `<tr><td>${info.label}</td><td>${c}</td><td>${pct}%</td></tr>`;
      }).join('')}
    </table>

    <div class="report-section-title">top hunters</div>
    <table class="report-table">
      <tr><th>rank</th><th>hunter</th><th>score</th><th>bugs</th></tr>
      ${lb.slice(0, 5).map((h, i) => `<tr><td>#${i + 1}</td><td>${escapeHtml(h.name)}</td><td>${h.score}</td><td>${h.count}</td></tr>`).join('') || '<tr><td colspan="4">no hunters yet</td></tr>'}
    </table>

    <div class="report-section-title">most-affected modules</div>
    <table class="report-table">
      <tr><th>module</th><th>bug count</th></tr>
      ${sortedModules.slice(0, 6).map(([mod, c]) => `<tr><td>${escapeHtml(mod)}</td><td>${c}</td></tr>`).join('') || '<tr><td colspan="2">no modules logged yet</td></tr>'}
    </table>
  `;
  document.getElementById('reportBackdrop').classList.add('open');
}

document.getElementById('exportBtn').addEventListener('click', exportCsv);
document.getElementById('reportBtn').addEventListener('click', renderReport);
document.getElementById('reportClose').addEventListener('click', () => {
  document.getElementById('reportBackdrop').classList.remove('open');
});
document.getElementById('reportBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'reportBackdrop') document.getElementById('reportBackdrop').classList.remove('open');
});

document.getElementById('soundBtn').addEventListener('click', () => {
  state.soundOn = !state.soundOn;
  saveState();
  document.getElementById('soundBtn').innerHTML = state.soundOn
    ? '<i class="ti ti-volume-2"></i>'
    : '<i class="ti ti-volume-3"></i>';
  if (state.soundOn) playTone(440, 0.1, 'sine', 0.1);
});

// ============================================================
// HELPERS
// ============================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function showToast(message, severity) {
  const stack = document.getElementById('toastStack');
  const toast = document.createElement('div');
  toast.className = `toast ${severity === 'critical' ? 'toast-critical' : ''}`;
  toast.innerHTML = message;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// MODAL + FORM HANDLING
// ============================================================

let selectedSeverity = null;

function openModal() {
  document.getElementById('modalBackdrop').classList.add('open');
  renderQuickHunters();
  document.getElementById('hunterName').focus();
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.getElementById('bugForm').reset();
  selectedSeverity = null;
  document.querySelectorAll('.sev-opt').forEach(b => b.classList.remove('active'));
}

document.getElementById('logBugBtn').addEventListener('click', openModal);
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

document.querySelectorAll('.sev-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sev-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSeverity = btn.dataset.sev;
    const bossWrap = document.getElementById('bossToggleWrap');
    if (state.boss.active && (selectedSeverity === 'critical' || selectedSeverity === 'high')) {
      bossWrap.style.display = 'flex';
    } else {
      bossWrap.style.display = 'none';
      document.getElementById('bossToggle').checked = false;
    }
  });
});

document.getElementById('bugForm').addEventListener('submit', (e) => {
  e.preventDefault();

  const hunter = document.getElementById('hunterName').value.trim();
  const title = document.getElementById('bugTitle').value.trim();
  const module = document.getElementById('bugModule').value.trim();
  const notes = document.getElementById('bugNotes').value.trim();
  const isBossKill = document.getElementById('bossToggle').checked;

  if (!hunter || !title) return;
  if (!selectedSeverity) {
    showToast('pick a severity before submitting', null);
    return;
  }

  const bossWasActive = state.boss.active;
  const bug = addBug({ hunter, title, severity: selectedSeverity, module, notes, isBossKill });
  const newAchievements = checkAchievements();
  saveState();
  renderAll();

  playBugSound(selectedSeverity);

  if (bug.bossKill) {
    playBossKillSound();
    fireConfetti();
    showToast(`<i class="ti ti-skull-bolt"></i> <b>${escapeHtml(hunter)}</b> slayed the boss bug &middot; +${bug.points}pts (3x)`, 'critical');
  } else {
    showToast(`<b>${escapeHtml(hunter)}</b> logged a ${SEVERITY[selectedSeverity].label} bug &middot; +${bug.points}pts`, selectedSeverity);
  }

  newAchievements.forEach((id, idx) => {
    const def = ACHIEVEMENT_DEFS.find(a => a.id === id);
    if (def) {
      setTimeout(() => {
        showToast(`<i class="ti ${def.icon}"></i> achievement unlocked: <b>${def.title}</b>`, null);
        playAchievementSound();
        fireConfetti();
      }, 500 * (idx + 1));
    }
  });

  closeModal();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('Reset the entire session? This clears all bugs, scores, and achievements.')) return;
  state = {
    bugs: [], hunters: {}, startedAt: Date.now(), unlockedAchievements: [],
    soundOn: state.soundOn, round: { active: false, endsAt: 0, durationMs: 0 },
    boss: { active: false, spawnedAt: 0, expiresAt: 0 }
  };
  saveState();
  renderAll();
});

// ============================================================
// INIT
// ============================================================

loadState();
renderAll();
document.getElementById('soundBtn').innerHTML = state.soundOn
  ? '<i class="ti ti-volume-2"></i>'
  : '<i class="ti ti-volume-3"></i>';
setInterval(renderClock, 1000);
setInterval(() => { renderComboMeter(); renderActivityFeed(); }, 5000);
setInterval(renderRoundUI, 1000);
setInterval(renderBossBanner, 1000);
setInterval(maybeSpawnBoss, 20000);
renderClock();

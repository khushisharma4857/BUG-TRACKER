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
  unlockedAchievements: []
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = parsed;
      // Date objects can't survive JSON, startedAt stays as number - fine.
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

function addBug({ hunter, title, severity, module, notes }) {
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
  const finalPoints = Math.round(points * (1 + comboBonus));

  h.score += finalPoints;
  h.count += 1;
  h.bySeverity[severity] += 1;
  if (module && !h.modules.includes(module)) h.modules.push(module);

  const bug = {
    id: 'bug_' + now + '_' + Math.random().toString(36).slice(2, 7),
    hunter, title, severity, module: module || 'general', notes: notes || '',
    points: finalPoints, comboAtLog: h.comboCount, timestamp: now
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

function renderLeaderboard() {
  const list = document.getElementById('leaderboardList');
  const lb = getLeaderboard();
  document.getElementById('hunterCount').textContent = `${lb.length} hunter${lb.length === 1 ? '' : 's'}`;

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

function renderActivityFeed() {
  const feed = document.getElementById('activityFeed');
  const recent = [...state.bugs].slice(-12).reverse();

  if (recent.length === 0) {
    feed.innerHTML = `<div class="empty-state small"><p>the war room is quiet. log a bug to break the silence.</p></div>`;
    return;
  }

  feed.innerHTML = recent.map(bug => {
    const info = SEVERITY[bug.severity];
    const timeAgo = formatTimeAgo(bug.timestamp);
    const comboNote = bug.comboAtLog >= 3 ? ` <b>+${Math.round(((bug.points / info.points) - 1) * 100)}% combo bonus</b>` : '';
    return `
      <div class="feed-item feed-${bug.severity}">
        <i class="ti ${info.icon} feed-icon"></i>
        <div class="feed-text"><b>${escapeHtml(bug.hunter)}</b> found a ${info.label} bug in <b>${escapeHtml(bug.module)}</b> &middot; "${escapeHtml(truncate(bug.title, 48))}" &middot; +${bug.points}pts${comboNote}</div>
        <div class="feed-time">${timeAgo}</div>
      </div>`;
  }).join('');
}

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
}

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
  });
});

document.getElementById('bugForm').addEventListener('submit', (e) => {
  e.preventDefault();

  const hunter = document.getElementById('hunterName').value.trim();
  const title = document.getElementById('bugTitle').value.trim();
  const module = document.getElementById('bugModule').value.trim();
  const notes = document.getElementById('bugNotes').value.trim();

  if (!hunter || !title) return;
  if (!selectedSeverity) {
    showToast('pick a severity before submitting', null);
    return;
  }

  const bug = addBug({ hunter, title, severity: selectedSeverity, module, notes });
  const newAchievements = checkAchievements();
  saveState();
  renderAll();

  showToast(`<b>${escapeHtml(hunter)}</b> logged a ${SEVERITY[selectedSeverity].label} bug &middot; +${bug.points}pts`, selectedSeverity);

  newAchievements.forEach((id, idx) => {
    const def = ACHIEVEMENT_DEFS.find(a => a.id === id);
    if (def) {
      setTimeout(() => {
        showToast(`<i class="ti ${def.icon}"></i> achievement unlocked: <b>${def.title}</b>`, null);
      }, 400 * (idx + 1));
    }
  });

  closeModal();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('Reset the entire session? This clears all bugs, scores, and achievements.')) return;
  state = { bugs: [], hunters: {}, startedAt: Date.now(), unlockedAchievements: [] };
  saveState();
  renderAll();
});

// ============================================================
// INIT
// ============================================================

loadState();
renderAll();
setInterval(renderClock, 1000);
setInterval(() => { renderComboMeter(); renderActivityFeed(); }, 5000);
renderClock();

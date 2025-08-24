(function () {
  'use strict';

  /* ---------- constants ---------- */
  const CATEGORIES = ['Fitness', 'Home', 'Finance', 'Work', 'Rose', 'Other'];
  const STORAGE = 'neon_tasks_v05';
  const CSV_PATH = 'assets/Cyberpunk App.csv';

  /* ---------- tiny helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const lc = s => s.toLowerCase();
  const escapeHTML = s => String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  const toast = (msg) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    document.getElementById('toast-layer').appendChild(t);
    setTimeout(() => t.remove(), 1800);
  };

  /* ---------- state ---------- */
  let state = loadState();

  function loadState(){
    try { return JSON.parse(localStorage.getItem(STORAGE)) || {
      tasks: [],
      power: 0,
      weights: { low:8, medium:16, high:28 },
      scaling: 'linear',
      bossTarget: 600,
      calendarCursor: (()=>{const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()};})(),
      characters: {}
    }; } catch { return {tasks:[], power:0, weights:{low:8,medium:16,high:28}, scaling:'linear', bossTarget:600, calendarCursor:{y:new Date().getFullYear(), m:new Date().getMonth()}, characters:{}}; }
  }
  function save(){ localStorage.setItem(STORAGE, JSON.stringify(state)); }

  /* ---------- image loader: always from assets/characters/<cat-lower>/<cat-lower>-<1..3>.png ---------- */
  function setCategoryPortrait(imgEl, category) {
    const base = `assets/characters/${lc(category)}/${lc(category)}-`;
    const candidates = [1, 2, 3].map(n => `${base}${n}.png`);
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        imgEl.alt = `${category} portrait (missing)`;
        imgEl.src =
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#0e1420"/><text x="50%" y="50%" fill="#9ab3cc" font-size="18" font-family="ui-sans-serif" text-anchor="middle">No image</text></svg>`);
        return;
      }
      imgEl.src = candidates[i++];
      imgEl.onerror = tryNext;
    };
    tryNext();
  }

  /* ---------- CSV (names/rarity only) ---------- */
  function parseCSV(text) {
    const rows = [];
    let i = 0, field = '', inQ = false, row = [];
    const push = () => { row.push(field); field = ''; };
    const end = () => { rows.push(row); row = []; };
    while (i < text.length) {
      const ch = text[i++];
      if (ch === '"') { if (inQ && text[i] === '"') { field += '"'; i++; } else inQ = !inQ; }
      else if (ch === ',' && !inQ) push();
      else if ((ch === '\n' || ch === '\r') && !inQ) { push(); end(); if (ch === '\r' && text[i] === '\n') i++; }
      else field += ch;
    }
    if (field !== '' || row.length) { push(); end(); }
    return rows;
  }

  async function loadCSV() {
    try {
      const res = await fetch(CSV_PATH, { cache:'no-store' });
      if (!res.ok) throw new Error('CSV not found');
      const rows = parseCSV(await res.text());
      if (!rows.length) throw new Error('CSV empty');

      const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
      const idx = (k) => headers.indexOf(k);
      const ixCat = Math.max(idx('task category'), idx('category'));
      const ixName = Math.max(idx('name/title'), idx('name'));
      const ixRar  = idx('rarity');

      const byCat = {};
      for (let r = 1; r < rows.length; r++) {
        const line = rows[r]; if (!line || !line.length) continue;
        const cat = cap(String(line[ixCat] || '').trim());
        if (!CATEGORIES.includes(cat)) continue;
        const name = (line[ixName] || '').trim() || `${cat} Ally`;
        const rarity = String(line[ixRar] || 'R').trim().toUpperCase();
        (byCat[cat] = byCat[cat] || []).push({ name, rarity });
      }
      return byCat;
    } catch (e) {
      console.warn('[CSV] fallback (names only):', e.message);
      return {};
    }
  }

  /* ---------- tabs ---------- */
  function wireTabs() {
    $$('.tabbar .tab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tabbar .tab').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const id = btn.dataset.tab;
        $$('.panel').forEach(p => p.classList.remove('is-on'));
        $('#' + id).classList.add('is-on');
        if (id === 'tasks') renderTasks();
        if (id === 'calendar') renderCalendar();
        if (id === 'characters') renderCharacters();
        if (id === 'boss') renderBoss();
        if (id === 'config') renderConfig();
      });
    });
  }

  /* ---------- power bar ---------- */
  function setPowerBar(){
    const pct = Math.max(0, Math.min(100, Math.round((state.power % state.bossTarget)/state.bossTarget*100)));
    document.getElementById('power-pct').textContent = pct + '%';
    const fill = document.getElementById('power-fill');
    if (fill){ fill.style.width = pct + '%'; fill.setAttribute('aria-valuenow', String(pct)); }
  }

  /* ---------- Summary ---------- */
  function renderSummary() {
    const grid = document.getElementById('summary-grid');
    grid.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const tile = document.createElement('a');
      tile.href = '#';
      tile.className = 'tile';
      tile.innerHTML = `<figure><img alt="${cat} character"><figcaption>${cat}</figcaption></figure>`;
      const img = tile.querySelector('img');
      setCategoryPortrait(img, cat);
      tile.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector(`.tabbar .tab[data-tab="characters"]`).click();
        const el = document.querySelector(`.char-card[data-cat="${cat}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      grid.appendChild(tile);
    });
  }

  /* ---------- Quick Create ---------- */
  function wireQuickAdd(){
    document.getElementById('quick-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const title = String(fd.get('title') || '').trim();
      if (!title){ toast('Add a title'); return; }
      const t = {
        id: uid(), title,
        due: fd.get('due') || null,
        priority: fd.get('priority') || 'medium',
        category: fd.get('category') || 'Other',
        notes: String(fd.get('notes')||'').trim(),
        hours: 0, type:'one-off', createdAt:new Date().toISOString(), done:false
      };
      state.tasks.push(t); save();
      toast('Task created ✓');
      e.currentTarget.reset();
      renderTasks(); renderCalendar();
    });
  }

  /* ---------- Tasks ---------- */
  function setupTaskToolbar(){
    const scopes = document.querySelectorAll('.scopes .scope');
    scopes.forEach(b=> b.addEventListener('click', ()=>{
      scopes.forEach(x=>x.classList.remove('is-active')); b.classList.add('is-active'); renderTasks();
    }));

    document.getElementById('task-search').addEventListener('input', renderTasks);

    const wrap = document.querySelector('.category-filters');
    wrap.addEventListener('click', (e)=>{
      const b = e.target.closest('.pill'); if(!b) return;
      document.querySelectorAll('.category-filters .pill').forEach(x=>x.classList.remove('is-on'));
      b.classList.add('is-on'); renderTasks();
    });

    const btn = document.getElementById('sort-btn');
    const menu = document.getElementById('sort-menu');
    btn.addEventListener('click', ()=>{
      const isOpen = !menu.hasAttribute('hidden');
      btn.setAttribute('aria-expanded', String(!isOpen));
      if (isOpen) menu.setAttribute('hidden',''); else menu.removeAttribute('hidden');
    });
    menu.addEventListener('click', (e)=>{
      const li = e.target.closest('[role="option"]'); if(!li) return;
      btn.textContent = 'Sort: ' + li.dataset.sort;
      btn.dataset.sort = li.dataset.sort;
      menu.setAttribute('hidden',''); btn.setAttribute('aria-expanded','false');
      renderTasks();
    });
  }

  function currentScope(){
    const on = document.querySelector('.scopes .scope.is-active'); return on ? on.dataset.scope : 'today';
  }
  function currentCategoryFilter(){
    const on = document.querySelector('.category-filters .pill.is-on'); return on ? on.dataset.filter : 'all';
  }
  function currentSort(){
    const b = document.getElementById('sort-btn'); return b?.dataset.sort || 'priority';
  }

  function renderTasks(){
    const q = (document.getElementById('task-search').value || '').toLowerCase();
    const scope = currentScope();
    const catF = currentCategoryFilter();
    const sort = currentSort();

    const now = new Date();
    const startOfWeek = (d)=>{ const dt=new Date(d); const day=(dt.getDay()+6)%7; dt.setDate(dt.getDate()-day); dt.setHours(0,0,0,0); return dt; };
    const endOfWeek   = (d)=>{ const s=startOfWeek(d); const e=new Date(s); e.setDate(e.getDate()+6); e.setHours(23,59,59,999); return e; };
    const inRange = (iso, a, b) => {
      if(!iso) return true;
      const d = new Date(iso+'T00:00:00');
      return d>=a && d<=b;
    };
    const todayISO = ()=> new Date().toISOString().slice(0,10);
    const isSameDayISO = (a, b)=> (a||'').slice(0,10) === (b||'').slice(0,10);

    let list = state.tasks.filter(t=>{
      if (catF !== 'all' && t.category !== catF) return false;
      if (q && !(t.title.toLowerCase().includes(q) || (t.notes||'').toLowerCase().includes(q))) return false;
      if (scope === 'today') return !t.due || isSameDayISO(t.due, todayISO());
      if (scope === 'week')  return !t.due || inRange(t.due, startOfWeek(now), endOfWeek(now));
      return true;
    });

    // Stats
    const done = state.tasks.filter(t=>t.done).length;
    const todayDue = state.tasks.filter(t=>t.due && isSameDayISO(t.due, todayISO()) && !t.done).length;
    document.getElementById('stat-done').textContent = done;
    document.getElementById('stat-today').textContent = todayDue;
    document.getElementById('stat-total').textContent = state.tasks.length;

    // Sort
    if (sort === 'priority'){
      const score = {low:1, medium:2, high:3};
      list.sort((a,b)=> (score[b.priority]||1) - (score[a.priority]||1));
    } else if (sort === 'due'){
      list.sort((a,b)=> (a.due||'9999-12-31').localeCompare(b.due||'9999-12-31'));
    } else {
      list.sort((a,b)=> (a.createdAt||'').localeCompare(b.createdAt||''));
    }

    // Group by due date
    const groups = new Map();
    for (const t of list){
      const key = t.due || 'No date';
      (groups.get(key) || groups.set(key, []).get(key)).push(t);
    }

    const host = document.getElementById('task-groups');
    host.innerHTML = '';
    if (!list.length){
      host.innerHTML = `<div class="empty">No tasks match your filters.</div>`;
      return;
    }

    for (const [key, arr] of groups.entries()){
      const groupNode = renderTaskGroup(key, arr);
      host.appendChild(groupNode);
    }
  }

  function renderTaskGroup(key, arr){
    const tpl = document.getElementById('tpl-task-group').content.cloneNode(true);
    const sec = tpl.querySelector('.task-group');
    sec.dataset.group = key;
    tpl.querySelector('.group-title').textContent = key === 'No date' ? 'No date' : key;
    tpl.querySelector('.group-count').textContent = String(arr.length);
    const list = tpl.querySelector('.task-list');
    arr.forEach(t => list.appendChild(renderTaskCard(t)));
    tpl.querySelector('.collapse').addEventListener('click', (e)=>{
      const btn = e.currentTarget;
      const open = btn.getAttribute('aria-expanded') !== 'false';
      btn.setAttribute('aria-expanded', String(!open));
      list.style.display = open ? 'none' : '';
    });
    return sec;
  }

  function renderTaskCard(t){
    const tpl = document.getElementById('tpl-task-card').content.cloneNode(true);
    const card = tpl.querySelector('.task-card');
    card.dataset.id = t.id;
    const dot = tpl.querySelector('.priority-dot');
    dot.classList.add(
      t.priority === 'high' ? 'priority-high' :
      t.priority === 'low'  ? 'priority-low'  : 'priority-medium'
    );
    tpl.querySelector('.title-text').textContent = t.title;
    tpl.querySelector('.pill.cat').textContent = t.category;
    tpl.querySelector('.pill.due').textContent = 'Due: ' + (t.due || '—');
    const notes = tpl.querySelector('.task-notes');
    if (t.notes) notes.textContent = t.notes; else notes.style.display = 'none';
    if (t.done) card.classList.add('completed');
    tpl.querySelector('[data-act="complete"]').addEventListener('click', ()=>{
      if (t.done) return;
      t.done = true;
      const xp = computeXP(t);
      state.power += xp; save(); setPowerBar();
      toast(`⚡ Completed: <strong>${escapeHTML(t.title)}</strong> <span class="muted">(+${xp} XP)</span>`);
      unlockCharacterMaybe(t.category, xp);
      renderTasks(); renderCalendar(); renderBoss();
    });
    return tpl;
  }

  function computeXP(t){
    const base = ({low:1,medium:2,high:3}[t.priority]||1)*10 + (Number(t.hours)||0)*5;
    if (state.scaling === 'sqrt') return Math.max(1, Math.round(Math.sqrt(base)*12));
    if (state.scaling === 'log')  return Math.max(1, Math.round(Math.log10(base+1)*24));
    return Math.max(1, Math.round(base));
  }

  /* ---------- Calendar ---------- */
  function renderCalendar(){
    const y = state.calendarCursor.y, m = state.calendarCursor.m; // m: 0..11
    const first = new Date(y, m, 1);
    const title = first.toLocaleString(undefined, { month:'long', year:'numeric' });
    document.getElementById('cal-title').textContent = title;

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const startDay = (first.getDay()+6)%7; // Monday=0
    const daysInMonth = new Date(y, m+1, 0).getDate();

    for (let i=0;i<startDay;i++){
      const blank = document.getElementById('tpl-calendar-cell').content.cloneNode(true);
      blank.querySelector('.cal-daynum').textContent = '';
      grid.appendChild(blank);
    }

    for (let d=1; d<=daysInMonth; d++){
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell = document.getElementById('tpl-calendar-cell').content.cloneNode(true);
      cell.querySelector('.cal-daynum').textContent = String(d);

      const list = state.tasks.filter(t=>t.due === iso);
      const chipsHost = cell.querySelector('.cal-chips');

      for (const t of list){
        const chip = document.getElementById('tpl-cal-chip').content.cloneNode(true);
        chip.querySelector('.chip-title').textContent = t.title;
        chip.querySelector('.chip-hours').textContent = (t.hours? `${t.hours}h` : '');
        chip.querySelector('.chip-done').hidden = !t.done;
        const el = chip.querySelector('.cal-chip');
        el.dataset.priority = t.priority || 'medium';
        if (t.done) el.classList.add('is-done');
        chipsHost.appendChild(chip);
      }

      const node = cell.children[0];
      node.addEventListener('click', ()=> {
        // simple day viewer
        const tasks = state.tasks.filter(t=>t.due===iso);
        const lines = tasks.map(t=> `• ${escapeHTML(t.title)} (${t.priority})`).join('<br>');
        toast(tasks.length ? `Tasks on ${iso}:<br>${lines}` : `No tasks on ${iso}`);
      });
      grid.appendChild(cell);
    }

    document.getElementById('cal-prev').onclick = ()=> { shiftMonth(-1); renderCalendar(); };
    document.getElementById('cal-next').onclick = ()=> { shiftMonth(+1); renderCalendar(); };
    document.getElementById('cal-today').onclick = ()=> {
      const d = new Date(); state.calendarCursor = { y:d.getFullYear(), m:d.getMonth() }; save(); renderCalendar();
    };
    document.getElementById('cal-generate').onclick = ()=> { generateRecurring(); renderCalendar(); };
  }
  function shiftMonth(delta){
    const d = new Date(state.calendarCursor.y, state.calendarCursor.m + delta, 1);
    state.calendarCursor = { y: d.getFullYear(), m: d.getMonth() }; save();
  }
  function generateRecurring(){
    // example: duplicate any repeat tasks (not fully implemented)
    toast('Recurring generation complete (demo)');
  }

  /* ---------- Characters ---------- */
  function pickRandom(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

  let csvNamesByCat = {}; // loaded at boot
  function renderCharacters(){
    const host = document.getElementById('chars');
    const empty = document.getElementById('chars-empty');
    host.innerHTML = '';
    let any = false;

    CATEGORIES.forEach(cat => {
      const pool = csvNamesByCat[cat] || [{ name: `${cat} Ally`, rarity: 'R' }];
      const chosen = pickRandom(pool);

      const card = document.getElementById('tpl-character-card').content.cloneNode(true);
      const root = card.querySelector('.char-card');
      root.dataset.cat = cat;
      root.querySelector('.char-name').textContent = chosen.name;
      root.querySelector('.char-rarity').textContent = chosen.rarity;
      root.querySelector('.char-category').textContent = cat;
      root.querySelector('.char-level .val').textContent = '1';
      root.querySelector('.char-bond .val').textContent = '5';
      const img = root.querySelector('.char-img');
      setCategoryPortrait(img, cat);

      // bars default
      root.querySelector('.bar.xp .fill').style.width = '10%';
      root.querySelector('.bar.bond .fill').style.width = '5%';

      // actions
      root.querySelector('[data-act="chat"]').onclick = ()=> toast(`💬 ${chosen.name}: "Stay sharp. Neon favors the focused."`);
      root.querySelector('[data-act="train"]').onclick = ()=> { toast(`🏋️ Trained ${chosen.name} (+20 XP)`); };
      root.querySelector('[data-act="gift"]').onclick = ()=> { toast(`🎁 Gifted ${chosen.name} (+10 bond)`); };

      host.appendChild(card);
      any = true;
    });

    empty.style.display = any ? 'none' : 'block';
  }

  function unlockCharacterMaybe(category, xp){
    // lightweight: no persistent character leveling in this compact build
    // hook exists for future expansion
  }

  /* ---------- Boss ---------- */
  function renderBoss(){
    const cycle = new Date().toISOString().slice(0,7);
    document.getElementById('boss-cycle').textContent = cycle;
    document.getElementById('boss-target').textContent = state.bossTarget;

    const pct = Math.round((state.power % state.bossTarget) / state.bossTarget * 100);
    document.getElementById('party-power-fill').style.width = pct + '%';
    document.getElementById('party-power-value').textContent = pct + '%';

    const chance = estimateWinChance(state.power, state.bossTarget);
    document.getElementById('boss-chance').textContent = Math.round(chance*100) + '%';

    document.getElementById('boss-simulate').onclick = ()=>{
      const win = Math.random() < chance;
      if (win){
        const reward = 50 + Math.floor(Math.random()*50);
        state.power += reward; save(); setPowerBar();
        document.getElementById('boss-result-text').innerHTML = `🧨 <strong>Victory!</strong> +${reward} XP`;
      }else{
        document.getElementById('boss-result-text').textContent = `💀 Defeat… keep grinding.`;
      }
      renderBoss();
    };
  }
  function estimateWinChance(power, target){
    const x = power - target; const k = 1/120;
    return 1/(1+Math.exp(-k*x));
  }

  /* ---------- Config ---------- */
  function renderConfig(){
    const w = state.weights;
    document.getElementById('weights-view').innerHTML = `
      <div>Low: <strong>${w.low}</strong></div>
      <div>Medium: <strong>${w.medium}</strong></div>
      <div>High: <strong>${w.high}</strong></div>
    `;
    document.getElementById('scaling-mode').value = state.scaling;

    document.querySelectorAll('.config-weights [data-preset]').forEach(b=>{
      b.onclick = ()=>{
        const p = b.dataset.preset;
        if (p==='aggressive') state.weights = { low:10, medium:22, high:38 };
        else if (p==='gentle') state.weights = { low:6,  medium:12, high:18 };
        else state.weights = { low:8, medium:16, high:28 };
        save(); renderConfig(); toast(`Preset ${p} applied`);
      };
    });

    document.getElementById('scaling-mode').onchange = (e)=> { state.scaling = e.target.value; save(); toast(`Scaling: ${state.scaling}`); };

    const inp = document.getElementById('boss-target-input'); if (inp) inp.value = state.bossTarget;
    document.getElementById('boss-target-apply').onclick = ()=>{
      const v = Math.max(10, Number(inp.value||600)); state.bossTarget = v; save(); renderBoss(); toast(`Boss target set to ${v}`);
    };

    document.getElementById('seed-demo').onclick = ()=> { seedDemo(); save(); renderAll(); toast('Seeded demo data'); };
    document.getElementById('reset-all').onclick = ()=>{
      const dlg = document.getElementById('confirm-reset'); dlg.showModal();
      dlg.addEventListener('close', ()=>{
        if (dlg.returnValue === 'confirm'){
          localStorage.removeItem(STORAGE);
          state = loadState(); renderAll(); toast('Data wiped');
        }
      }, { once:true });
    };
  }

  function seedDemo(){
    const base = new Date().toISOString().slice(0,10);
    const add = (title, offset, pr, cat, notes='')=>{
      const d = new Date(base+'T00:00:00'); d.setDate(d.getDate()+offset);
      state.tasks.push({
        id: uid(), title, due: d.toISOString().slice(0,10),
        priority: pr, category: cat, notes, hours: Math.random()<.5?1:2, type:'one-off',
        createdAt: new Date().toISOString(), done:false
      });
    };
    state.tasks.length = 0;
    add('30‑minute run', 0, 'high', 'Fitness', 'Zone 2');
    add('Meal prep', 1, 'medium', 'Home');
    add('Invoice review', 2, 'medium', 'Finance');
    add('Sprint planning', 3, 'high', 'Work');
    add('Call Rose', -1, 'low', 'Rose');
    add('Declutter desk', 4, 'low', 'Other');
  }

  /* ---------- Boot ---------- */
  async function boot(){
    wireTabs();
    wireQuickAdd();
    setupTaskToolbar();
    setPowerBar();
    renderSummary();
    renderTasks();
    renderCalendar();
    csvNamesByCat = await loadCSV();
    renderCharacters();
    renderBoss();
    renderConfig();
  }

  function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }

  window.addEventListener('DOMContentLoaded', boot);
})();
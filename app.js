/* NEON/TASKS v0.4 — app.js (FULL, case‑safe images + CSV + mobile polish)
  - Categories (as in your current index.html): Fitness, Home, Work, Finance, Skills, Rose, Other
  - Characters are picked per category per page load (random variant 1..3)
  - Images resolve robustly (handles Finance/finance folder/file casing, root files, CSV paths)
  - CSV: assets/Cyberpunk App.csv (optional). If present, we pick from it; else we fall back.
  - Service worker cache busting when loading images to avoid cached 404s.
*/

(function () {
  'use strict';

  /* ============== DOM helpers ============== */
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const setHidden = (el, h) => { if (!el) return; h ? el.setAttribute('hidden','') : el.removeAttribute('hidden'); };
  const text = (el, s) => { if (el) el.textContent = s; };

  /* ============== Constants / State ============== */
  const CATEGORIES = ['Fitness','Home','Work','Finance','Skills','Rose','Other']; // matches index.html
  const STORAGE = 'neon_tasks_v04';
  const VERSION = '0.4';
  const BUILD_ID = Date.now(); // for cache‑busting image URLs

  const PRIORITY_SCORE = { low:1, medium:2, high:3 };
  const DEFAULT_WEIGHTS = { low:8, medium:16, high:28 };
  const DEFAULT_SCALING = 'linear';
  const DEFAULT_BOSS_TARGET = 600;

  function initialState(){
    const d = new Date();
    return {
      version: VERSION,
      tasks: [],
      characters: {},      // keyed by category
      power: 0,
      weights: { ...DEFAULT_WEIGHTS },
      scaling: DEFAULT_SCALING,
      bossTarget: DEFAULT_BOSS_TARGET,
      calendarCursor: { y:d.getFullYear(), m:d.getMonth() }, // 0‑indexed month
      meta: { completed:0 }
    };
  }
  function load(){ try{ return JSON.parse(localStorage.getItem(STORAGE)) || initialState(); } catch { return initialState(); } }
  function save(){ localStorage.setItem(STORAGE, JSON.stringify(state)); }

  const state = load();

  /* ============== CSV & Character Portraits ============== */

  const sessionVariant = {};          // e.g., { Finance: 2 }
  const csvPool = { byCat: {}, all: []};
  const sessionPick = {};             // one chosen record per category (used everywhere this load)
  const portraits = {};               // convenience (string path) for quick places

  const lc = s => String(s||'').trim().toLowerCase();
  const cap = s => { s = String(s||'').trim(); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
  const fileOnly = p => String(p||'').trim().split('/').pop();
  const bust = url => url + (url.includes('?') ? '&' : '?') + 'v=' + BUILD_ID;

  // Build candidates that cover common repo/case layouts
  function portraitCandidates(category, filename){
    const L = lc(category), C = cap(category);
    const base = fileOnly(filename||'').replace(/\s+/g, '%20');

    const list = [];
    if (/^https?:\/\//i.test(base) || /^assets\//i.test(base)) list.push(base);
    else if (base) {
      list.push(`assets/characters/${C}/${base}`);
      list.push(`assets/characters/${L}/${base}`);
      if (base.toLowerCase().startsWith(L+'-')) {
        const fixed = C + base.slice(L.length);
        list.push(`assets/characters/${C}/${fixed}`);
        list.push(`assets/characters/${L}/${fixed}`);
      }
    }

    const v = getVariant(category);
    list.push(`assets/characters/${C}/${C}-${v}.png`);
    list.push(`assets/characters/${L}/${L}-${v}.png`);
    list.push(`assets/characters/${C}/${C}-1.png`);

    // dedupe
    const seen = new Set(); const uniq = [];
    for (const u of list){ if (!seen.has(u)){ seen.add(u); uniq.push(u); } }
    return uniq;
  }

  // Assign <img>.src with automatic fallbacks
  function setPortrait(img, category, preferred){
    if (!img) return;
    const cands = portraitCandidates(category, preferred);
    let i = 0;
    function next(){
      if (i >= cands.length) return;
      img.onerror = () => { i++; next(); };
      img.src = bust(cands[i]);
    }
    next();
  }

  function getVariant(cat){
    if (!sessionVariant[cat]) sessionVariant[cat] = 1 + Math.floor(Math.random()*3);
    return sessionVariant[cat];
  }

  async function loadCSV(){
    try{
      const res = await fetch('assets/Cyberpunk App.csv', { cache:'no-store' });
      if(!res.ok) throw new Error('CSV not found');
      const text = await res.text();
      const rows = parseCSV(text);
      if (!rows.length) throw new Error('CSV empty');
      const headers = rows[0].map(h => lc(h));
      const idx = (name)=> headers.indexOf(lc(name));
      const get = (line, key)=> {
        const j = idx(key); return (j>-1 && j<line.length) ? String(line[j]||'').trim() : '';
      };
      csvPool.byCat = {}; csvPool.all = [];
      for (let r=1; r<rows.length; r++){
        const row = rows[r]; if (!row || !row.length) continue;
        const cat = cap(get(row,'task category') || get(row,'category') || 'Other');
        const img = get(row,'image') || get(row,'filename');
        const name = get(row,'name') || get(row,'name/title') || (cat+' Ally');
        const rarity = (get(row,'rarity')||'R').toUpperCase();
        (csvPool.byCat[cat] ||= []).push({ Category:cat, Image:img, Name:name, Rarity:rarity });
        csvPool.all.push({ Category:cat, Image:img, Name:name, Rarity:rarity });
      }

      // Choose one per category for this session
      for (const cat of CATEGORIES){
        const list = csvPool.byCat[cat] || [];
        if (list.length){
          const v = getVariant(cat);
          // Prefer a record whose filename matches the chosen variant
          let chosen = list.find(r => fileOnly(r.Image).toLowerCase().startsWith(lc(cat)+'-'+v)) || list[Math.floor(Math.random()*list.length)];
          sessionPick[cat] = chosen;
          portraits[cat] = portraitCandidates(cat, chosen.Image)[0];
        } else {
          sessionPick[cat] = null;
          portraits[cat] = portraitCandidates(cat, `${lc(cat)}-${getVariant(cat)}.png`)[0];
        }
      }
    }catch(e){
      console.warn('[CSV]', e && e.message || e);
      // Fall back to guessed images
      for (const cat of CATEGORIES){
        sessionPick[cat] = null;
        portraits[cat] = portraitCandidates(cat, `${lc(cat)}-${getVariant(cat)}.png`)[0];
      }
    }
  }

  // Tiny CSV parser that handles quotes
  function parseCSV(text){
    const rows=[], row=[]; let i=0, f='', inQ=false;
    const push=()=>{ row.push(f); f=''; };
    const end =()=>{ rows.push(row.slice()); row.length=0; };
    while(i<text.length){
      const ch=text[i++];
      if(ch === '"'){ if(inQ && text[i]==='"'){ f+='"'; i++; } else inQ=!inQ; }
      else if(ch===',' && !inQ){ push(); }
      else if((ch==='\n'||ch==='\r') && !inQ){ push(); end(); if(ch==='\r'&&text[i]==='\n') i++; }
      else { f+=ch; }
    }
    if(f!==''||row.length){ push(); end(); }
    return rows;
  }

  /* ============== Tabs ============== */
  function setupTabs(){
    const tabs = $$('.tabbar .tab');
    tabs.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        tabs.forEach(b=> b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const id = 'tab-' + btn.dataset.tab;
        $$('.main .tabpanel').forEach(s => setHidden(s, s.id !== id));
        // lazy renders
        if (id === 'tab-summary') renderSummary();
        if (id === 'tab-tasks')   renderTasks();
        if (id === 'tab-calendar') renderCalendar();
        if (id === 'tab-characters') renderCharacters();
        if (id === 'tab-boss') renderBoss();
        if (id === 'tab-config') renderConfig();
        $('#main').focus({ preventScroll:true });
      });
    });
  }

  /* ============== Power Bar ============== */
  function setPowerBar(){
    const pct = Math.max(0, Math.min(100, Math.round((state.power % state.bossTarget)/state.bossTarget*100)));
    text($('#power-percent'), pct+'%');
    const fill = $('#power-fill');
    if (fill){ fill.style.width = pct + '%'; fill.setAttribute('aria-valuenow', String(pct)); }
  }

  /* ============== Summary ============== */
  function renderSummary(){
    // The placeholders already exist; just set their images safely.
    $$('.summary-tile').forEach(tile=>{
      const cat = tile.getAttribute('data-category') || 'Other';
      const img = $('.summary-img', tile);
      setPortrait(img, cat, (sessionPick[cat] && sessionPick[cat].Image) || portraits[cat]);
      tile.onclick = (e)=>{
        e.preventDefault();
        openLightboxImage(cat);
      };
    });
  }

  /* ============== Quick Create (Create tab) ============== */
  function setupQuickCreate(){
    const form = $('#quick-create-form');
    if(!form) return;
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const fd = new FormData(form);
      const title = String(fd.get('title')||'').trim();
      if(!title){ form.reportValidity?.(); return; }
      const t = {
        id: uid(),
        title,
        due: fd.get('due') || null,
        priority: fd.get('priority') || 'medium',
        category: fd.get('category') || 'Other',
        notes: String(fd.get('notes')||'').trim(),
        hours: 0,
        type: 'one-off',
        createdAt: new Date().toISOString(),
        done: false
      };
      state.tasks.push(t); save();
      toast(`Task created: <strong>${escapeHTML(title)}</strong>`);
      form.reset();
      renderTasks(); renderCalendar();
    });
  }

  /* ============== Tasks (toolbar + list) ============== */
  function escapeHTML(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }

  function setupTaskToolbar(){
    const scopes = $$('.scopes .scope');
    scopes.forEach(b=>{
      b.addEventListener('click', ()=>{
        scopes.forEach(x=>x.classList.remove('is-active'));
        b.classList.add('is-active');
        renderTasks();
      });
    });

    $('#task-search')?.addEventListener('input', renderTasks);

    // category filters
    const wrap = $('.category-filters');
    wrap?.addEventListener('click', (e)=>{
      const b = e.target.closest('.pill'); if(!b) return;
      $$('.category-filters .pill').forEach(x=>x.classList.remove('is-on'));
      b.classList.add('is-on');
      renderTasks();
    });

    // sort menu
    const btn = $('#sort-btn');
    const menu = $('#sort-menu');
    btn?.addEventListener('click', ()=>{
      const isOpen = !menu.hasAttribute('hidden');
      btn.setAttribute('aria-expanded', String(!isOpen));
      setHidden(menu, isOpen);
    });
    menu?.addEventListener('click', (e)=>{
      const li = e.target.closest('[role="option"]'); if(!li) return;
      btn.textContent = 'Sort: ' + li.dataset.sort;
      btn.dataset.sort = li.dataset.sort;
      setHidden(menu, true);
      btn.setAttribute('aria-expanded','false');
      renderTasks();
    });

    // FAB opens add dialog
    $('#fab-add')?.addEventListener('click', openAddDialog);
  }

  function currentScope(){
    const on = $('.scopes .scope.is-active');
    return on ? on.dataset.scope : 'today';
    }

  function currentCategoryFilter(){
    const on = $('.category-filters .pill.is-on');
    return on ? on.dataset.filter : 'all';
  }

  function currentSort(){
    const b = $('#sort-btn');
    return b?.dataset.sort || 'priority';
  }

  function renderTasks(){
    const q = lc($('#task-search')?.value || '');
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

    let list = state.tasks.filter(t=>{
      if (catF !== 'all' && t.category !== catF) return false;
      if (q && !(lc(t.title).includes(q) || lc(t.notes||'').includes(q))) return false;
      if (scope === 'today') return !t.due || isSameDayISO(t.due, todayISO());
      if (scope === 'week')  return !t.due || inRange(t.due, startOfWeek(now), endOfWeek(now));
      return true;
    });

    // Stats
    const done = state.tasks.filter(t=>t.done).length;
    const todayDue = state.tasks.filter(t=>t.due && isSameDayISO(t.due, todayISO()) && !t.done).length;
    text($('#stat-done'), done);
    text($('#stat-today'), todayDue);
    text($('#stat-total'), state.tasks.length);

    // Sort
    if (sort === 'priority') list.sort((a,b)=> PRIORITY_SCORE[b.priority]-PRIORITY_SCORE[a.priority]);
    else if (sort === 'due') list.sort((a,b)=> (a.due||'9999-12-31').localeCompare(b.due||'9999-12-31'));
    else list.sort((a,b)=> (a.createdAt||'').localeCompare(b.createdAt||''));

    // Group by due date
    const groups = new Map();
    for (const t of list){
      const key = t.due || 'No date';
      (groups.get(key) || groups.set(key, []).get(key)).push(t);
    }

    const host = $('#task-groups');
    host.innerHTML = '';
    if (!list.length){
      host.innerHTML = `<div class="empty-state">No tasks match your filters.</div>`;
      return;
    }

    for (const [key, arr] of groups.entries()){
      const groupNode = renderTaskGroup(key, arr);
      host.appendChild(groupNode);
    }
  }

  function renderTaskGroup(key, arr){
    const tpl = $('#tpl-task-group').content.cloneNode(true);
    const sec = tpl.querySelector('.task-group');
    sec.dataset.group = key;
    tpl.querySelector('.group-title').textContent = key === 'No date' ? 'No date' : key;
    tpl.querySelector('.group-count').textContent = String(arr.length);
    const list = tpl.querySelector('.task-list');

    arr.forEach(t => list.appendChild(renderTaskCard(t)));

    // collapse
    const btn = tpl.querySelector('.collapse');
    btn.addEventListener('click', ()=>{
      const open = btn.getAttribute('aria-expanded') !== 'false';
      btn.setAttribute('aria-expanded', String(!open));
      list.style.display = open ? 'none' : '';
    });

    return sec;
  }

  function renderTaskCard(t){
    const tpl = $('#tpl-task-card').content.cloneNode(true);
    const card = tpl.querySelector('.task-card');
    card.dataset.id = t.id;

    const priorityDot = tpl.querySelector('.priority-dot');
    priorityDot.classList.add(
      t.priority === 'high' ? 'priority-high' :
      t.priority === 'low'  ? 'priority-low'  : 'priority-medium'
    );

    tpl.querySelector('.title-text').textContent = t.title;
    tpl.querySelector('.pill.cat').textContent = t.category;
    tpl.querySelector('.pill.due').textContent = 'Due: ' + (t.due || '—');
    if (t.notes) tpl.querySelector('.task-notes').textContent = t.notes; else setHidden(tpl.querySelector('.task-notes'), true);

    if (t.done) card.classList.add('completed');

    // Complete handler
    tpl.querySelector('[data-act="complete"]').addEventListener('click', ()=>{
      if (t.done) return;
      t.done = true;
      state.meta.completed++;
      const xp = computeXP(t);
      state.power += xp;
      save();
      setPowerBar();
      toast(`⚡ Completed: <strong>${escapeHTML(t.title)}</strong> <span class="muted">(+${xp} XP)</span>`);
      unlockCharacterMaybe(t.category, xp);
      card.classList.add('completed','zap');
      // little floating XP chip
      const chip = document.createElement('div');
      chip.className = 'xp-burst';
      chip.textContent = `+${xp} XP`;
      card.appendChild(chip);
      setTimeout(()=> chip.remove(), 900);
      renderBoss();
      renderCalendar();
    });

    return tpl;
  }

  function isSameDayISO(a, b){ return (a||'').slice(0,10) === (b||'').slice(0,10); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }

  function computeXP(t){
    const base = (PRIORITY_SCORE[t.priority]||1) * 10 + (Number(t.hours)||0)*5;
    if (state.scaling === 'sqrt') return Math.max(1, Math.round(Math.sqrt(base)*12));
    if (state.scaling === 'log')  return Math.max(1, Math.round(Math.log10(base+1)*24));
    return Math.max(1, Math.round(base));
  }

  /* ============== Add Task Dialog ============== */
  function openAddDialog(){
    const dlg = $('#add-task-dialog');
    if (!dlg) return;
    const pills = $('#task-category-pills');
    const hiddenCat = $('#task-category');
    const preview = $('#task-character-preview');

    // default selection
    hiddenCat.value = 'Fitness';
    setPortrait(preview, 'Fitness', portraits['Fitness']);

    // pill radios
    pills.querySelectorAll('.pill-radio').forEach((b,i)=>{
      b.classList.toggle('is-on', i===0);
      b.onclick = ()=>{
        pills.querySelectorAll('.pill-radio').forEach(x=>x.classList.remove('is-on'));
        b.classList.add('is-on');
        hiddenCat.value = b.dataset.value;
        setPortrait(preview, hiddenCat.value, (sessionPick[hiddenCat.value] && sessionPick[hiddenCat.value].Image) || portraits[hiddenCat.value]);
      };
    });

    $('#add-task-close')?.addEventListener('click', ()=> dlg.close(), { once:true });

    $('#add-task-form').onsubmit = (e)=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = String(fd.get('title')||'').trim();
      if(!title){ e.target.reportValidity?.(); return; }
      const t = {
        id: uid(),
        title,
        category: hiddenCat.value,
        priority: fd.get('priority') || 'medium',
        type: fd.get('type') || 'one-off',
        hours: Number(fd.get('hours')||0),
        repeat: fd.get('repeat') || 'none',
        start: fd.get('start') || null,
        end:   fd.get('end')   || null,
        due:   fd.get('end') || fd.get('start') || null,
        notes: String(fd.get('notes')||'').trim(),
        createdAt: new Date().toISOString(),
        done: false
      };
      state.tasks.push(t); save();
      toast(`Task added: <strong>${escapeHTML(t.title)}</strong>`);
      dlg.close();
      renderTasks(); renderCalendar();
    };

    dlg.showModal();
  }

  /* ============== Calendar ============== */
  function renderCalendar(){
    const y = state.calendarCursor.y, m = state.calendarCursor.m; // m: 0..11
    const first = new Date(y, m, 1);
    const title = first.toLocaleString(undefined, { month:'long', year:'numeric' });
    text($('#cal-title'), title);

    const grid = $('#calendar-grid');
    grid.innerHTML = '';

    // weekday header
    const weekdays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    for (const w of weekdays){
      const h = document.createElement('div');
      h.textContent = w;
      h.className = 'weekday';
      grid.appendChild(h);
    }

    const startDay = (first.getDay()+6)%7; // Monday=0
    const daysInMonth = new Date(y, m+1, 0).getDate();

    for (let i=0;i<startDay;i++){
      const blank = $('#tpl-calendar-cell').content.cloneNode(true);
      blank.querySelector('.cal-daynum').textContent = '';
      grid.appendChild(blank);
    }

    for (let d=1; d<=daysInMonth; d++){
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell = $('#tpl-calendar-cell').content.cloneNode(true);
      cell.querySelector('.cal-daynum').textContent = String(d);

      const list = state.tasks.filter(t=>t.due === iso);
      const chipsHost = cell.querySelector('.cal-chips');

      for (const t of list){
        const chip = $('#tpl-cal-chip').content.cloneNode(true);
        chip.querySelector('.chip-title').textContent = t.title;
        chip.querySelector('.chip-hours').textContent = (t.hours? `${t.hours}h` : '');
        chip.querySelector('.chip-done').hidden = !t.done;
        const el = chip.querySelector('.cal-chip');
        el.dataset.priority = t.priority || 'medium';
        if (t.done) el.classList.add('is-done');
        chipsHost.appendChild(chip);
      }

      const node = cell.children[0];
      node.addEventListener('click', ()=> openDayLightbox(iso, list));
      grid.appendChild(cell);
    }

    // nav
    $('#cal-prev').onclick = ()=> { shiftMonth(-1); renderCalendar(); };
    $('#cal-next').onclick = ()=> { shiftMonth(+1); renderCalendar(); };
    $('#cal-today').onclick = ()=> {
      const d = new Date();
      state.calendarCursor = { y:d.getFullYear(), m:d.getMonth() }; save(); renderCalendar();
    };
    $('#cal-generate').onclick = ()=> { generateRecurring(); renderCalendar(); };
  }

  function shiftMonth(delta){
    const d = new Date(state.calendarCursor.y, state.calendarCursor.m + delta, 1);
    state.calendarCursor = { y: d.getFullYear(), m: d.getMonth() }; save();
  }

  function openDayLightbox(iso, tasks){
    const box = $('#lightbox');
    const img = $('#lightbox-img');
    const content = $('#lightbox-content');
    const caption = $('#lightbox-caption');
    setHidden(img, true);
    setHidden(content, false);
    box.setAttribute('aria-hidden','false');

    const html = `
      <div class="day-head">
        <div class="day-title">${iso}</div>
        <div class="day-count">${tasks.length} task(s)</div>
      </div>
      <div class="day-list">
        ${tasks.map(t=>`
          <div class="day-item" data-id="${t.id}">
            <div class="title"><span class="priority-dot ${t.priority==='high'?'priority-high':t.priority==='low'?'priority-low':'priority-medium'}"></span>
              <span class="title-text">${escapeHTML(t.title)}</span>
            </div>
            <div class="meta">
              <span class="pill">${t.category}</span>
              <span class="pill">Priority: ${t.priority}</span>
              ${t.hours? `<span class="pill">~${t.hours}h</span>`:''}
              ${t.due? `<span class="pill">Due: ${t.due}</span>`:''}
            </div>
            ${t.notes ? `<div class="notes">${escapeHTML(t.notes)}</div>`:''}
          </div>
        `).join('')}
      </div>`;
    content.innerHTML = html;

    $('#lightbox-close').onclick = ()=> { box.setAttribute('aria-hidden','true'); };
  }

  function generateRecurring(){
    // Simple example: duplicate future repeats based on "repeat" field
    const addDays = (iso, n)=> {
      const d = new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10);
    };
    let created = 0;
    for (const base of state.tasks){
      if (base.type !== 'repeat' || !base.start) continue;
      const step = base.repeat==='daily'? 1 : base.repeat==='weekly'? 7 : base.repeat==='biweekly'? 14 : base.repeat==='monthly'? 30 : 0;
      if (!step) continue;
      let date = base.start;
      for (let i=0;i<60;i+=step){
        const iso = addDays(base.start, i);
        if (iso < todayISO()) continue;
        const exists = state.tasks.some(t=>t.title===base.title && t.due===iso);
        if (!exists){
          state.tasks.push({ ...base, id: uid(), due: iso, createdAt: new Date().toISOString(), done:false });
          created++;
        }
      }
    }
    save();
    toast(created ? `Generated <strong>${created}</strong> task(s)` : `No new recurring tasks`);
  }

  /* ============== Characters ============== */
  function unlockCharacterMaybe(category, xp){
    if (!state.characters[category]){
      const rec = sessionPick[category];
      state.characters[category] = {
        category,
        name: (rec && rec.Name) || `${category} Ally`,
        rarity: (rec && rec.Rarity) || 'R',
        level: 1,
        bond: 0,
        xp: 0,
        xpToNext: 100,
        image: (rec && rec.Image) || null
      };
      toast(`🎉 Unlocked: <strong>${escapeHTML(state.characters[category].name)}</strong> (${state.characters[category].rarity})`);
      save();
    }
    const ch = state.characters[category];
    if (!ch) return;
    ch.xp += Math.floor(xp*0.6);
    ch.bond = Math.min(100, ch.bond + Math.floor(xp*0.2));
    while (ch.xp >= ch.xpToNext){
      ch.xp -= ch.xpToNext; ch.level++; ch.xpToNext = Math.round(ch.xpToNext*1.25);
      toast(`⬆️ ${escapeHTML(ch.name)} reached Lv.${ch.level}`);
    }
    save();
    renderCharacters();
  }

  function renderCharacters(){
    const host = $('#characters-list');
    const empty = $('#characters-empty');
    const list = Object.values(state.characters);
    setHidden(empty, list.length>0);
    host.innerHTML = '';

    for (const ch of list){
      const card = $('#tpl-character-card').content.cloneNode(true);
      card.querySelector('.char-name').textContent = ch.name;
      card.querySelector('.char-rarity').textContent = ch.rarity;
      card.querySelector('.char-category').textContent = ch.category;
      card.querySelector('.char-level .val').textContent = ch.level;
      card.querySelector('.char-bond .val').textContent = ch.bond+'%';
      const img = card.querySelector('.char-img');
      setPortrait(img, ch.category, ch.image || portraits[ch.category]);

      // bars
      const xpFill = card.querySelector('.bar.xp .fill');
      const bondFill = card.querySelector('.bar.bond .fill');
      xpFill.style.width = Math.round(ch.xp / ch.xpToNext * 100) + '%';
      bondFill.style.width = ch.bond + '%';

      card.querySelector('.char-image-btn').onclick = ()=> openLightboxImage(ch.category, ch.name);

      // actions
      card.querySelector('[data-act="chat"]').onclick = ()=> toast(`💬 ${ch.name}: "Stay sharp. Neon favors the focused."`);
      card.querySelector('[data-act="train"]').onclick = ()=> { ch.xp += 20; save(); renderCharacters(); toast(`🏋️ Trained ${ch.name} (+20 XP)`); };
      card.querySelector('[data-act="gift"]').onclick = ()=> { ch.bond = Math.min(100, ch.bond + 10); save(); renderCharacters(); toast(`🎁 Gifted ${ch.name} (+10 bond)`); };

      host.appendChild(card);
    }
  }

  function openLightboxImage(category, captionText){
    const box = $('#lightbox');
    const img = $('#lightbox-img');
    const content = $('#lightbox-content');
    const caption = $('#lightbox-caption');
    setHidden(content, true);
    setHidden(img, false);
    box.setAttribute('aria-hidden','false');
    caption.textContent = captionText || `${category} portrait`;
    setPortrait(img, category, (sessionPick[category] && sessionPick[category].Image) || portraits[category]);
    $('#lightbox-close').onclick = ()=> { box.setAttribute('aria-hidden','true'); };
  }

  /* ============== Boss ============== */
  function renderBoss(){
    const cycle = new Date().toISOString().slice(0,7);
    text($('#boss-cycle'), cycle);
    text($('#boss-target'), state.bossTarget);

    const pct = Math.round((state.power % state.bossTarget) / state.bossTarget * 100);
    const fill = $('#party-power-fill');
    if (fill) fill.style.width = pct + '%';
    text($('#party-power-value'), pct + '%');

    const chance = estimateWinChance(state.power, state.bossTarget);
    text($('#boss-chance'), Math.round(chance*100) + '%');

    $('#boss-simulate').onclick = ()=>{
      const win = Math.random() < chance;
      if (win){
        const reward = 50 + Math.floor(Math.random()*50);
        state.power += reward; save(); setPowerBar();
        $('#boss-result-text').innerHTML = `🧨 <strong>Victory!</strong> +${reward} XP`;
      }else{
        $('#boss-result-text').textContent = `💀 Defeat… keep grinding.`;
      }
      renderBoss();
    };
  }
  function estimateWinChance(power, target){
    const x = power - target; const k = 1/120;
    return 1/(1+Math.exp(-k*x));
  }

  /* ============== Config ============== */
  function renderConfig(){
    // weights view
    const w = state.weights;
    $('#weights-view').innerHTML = `
      <div>Low: <strong>${w.low}</strong></div>
      <div>Medium: <strong>${w.medium}</strong></div>
      <div>High: <strong>${w.high}</strong></div>
    `;
    $('#scaling-mode').value = state.scaling;

    // presets
    $$('.config-weights [data-preset]').forEach(b=>{
      b.onclick = ()=>{
        const p = b.dataset.preset;
        if (p==='aggressive') state.weights = { low:10, medium:22, high:38 };
        else if (p==='gentle') state.weights = { low:6,  medium:12, high:18 };
        else state.weights = { ...DEFAULT_WEIGHTS };
        save(); renderConfig(); toast(`Preset <strong>${p}</strong> applied`);
      };
    });

    $('#scaling-mode').onchange = (e)=> { state.scaling = e.target.value; save(); toast(`Scaling: <strong>${state.scaling}</strong>`); };

    // boss target
    const inp = $('#boss-target-input'); if (inp) inp.value = state.bossTarget;
    $('#boss-target-apply').onclick = ()=>{
      const v = Math.max(10, Number(inp.value||DEFAULT_BOSS_TARGET));
      state.bossTarget = v; save(); renderBoss(); toast(`Boss target set to <strong>${v}</strong>`);
    };

    // data buttons
    $('#seed-demo').onclick = ()=> { seedDemo(); save(); renderAll(); toast('Seeded demo data'); };
    $('#reset-all').onclick = ()=>{
      const dlg = $('#confirm-reset'); dlg.showModal();
      dlg.addEventListener('close', ()=>{
        if (dlg.returnValue === 'confirm'){
          localStorage.removeItem(STORAGE);
          Object.assign(state, initialState());
          save(); renderAll(); toast('Data wiped');
        }
      }, { once:true });
    };
  }

  function seedDemo(){
    const base = todayISO();
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
    add('Tutorial practice', 4, 'low', 'Skills');

    state.tasks.push({
      id: uid(), title:'Daily stretch', category:'Fitness', priority:'low',
      type:'repeat', start: base, repeat:'daily', hours:.25, notes:'5 mins', due: base,
      createdAt:new Date().toISOString(), done:false
    });

    state.power = 120;
    state.characters = {};
  }

  /* ============== Toasts & Misc ============== */
  function toast(html){
    const layer = $('#toast-layer');
    if (!layer) return;
    const div = document.createElement('div');
    div.className = 'toast';
    div.innerHTML = html;
    layer.appendChild(div);
    setTimeout(()=> div.remove(), 2200);
  }
  const uid = ()=> Math.random().toString(36).slice(2)+Date.now().toString(36);

  /* ============== Boot ============== */
  async function boot(){
    setupTabs();
    setupQuickCreate();
    setupTaskToolbar();

    await loadCSV();

    setPowerBar();
    renderAll();

    // SW register (no-op if absent)
    if ('serviceWorker' in navigator){
      try { navigator.serviceWorker.register('./service-worker.js'); } catch {}
    }

    // Calendar nav buttons (attach once)
    $('#cal-prev')?.addEventListener('click', ()=>{});
  }

  function renderAll(){
    renderSummary();
    renderTasks();
    renderCalendar();
    renderCharacters();
    renderBoss();
    renderConfig();
  }

  // helpers used above
  function isSameDayISO(a,b){ return (a||'').slice(0,10)===(b||'').slice(0,10); }

  window.addEventListener('DOMContentLoaded', boot);
})();

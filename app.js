/* NEON/TASKS v0.4 — categories + CSV/asset path update
   - Categories: Fitness, Home, Finance, Work, Rose, Other
   - Character selection: random per category per load
   - Assets: /assets/characters/[Category]/[Category]-[1..3].png (fallback if CSV missing image)
*/

(() => {
  "use strict";

  // ---------- Constants ----------
  const LS_KEY = "neon_tasks_v04";
  const CATEGORIES = ["Fitness","Home","Finance","Work","Rose","Other"];
  const PRIORITY_COLORS = { Low: "#00fff0", Medium: "#ffe066", High: "#ff355e" };
  const DEFAULT_CONFIG = {
    xpPreset: "Default",
    scale: "Linear",
    bossTarget: 300,
    weights: { priority: { Low:1, Medium:2, High:3 }, estHour: 1, streak: 0.5 }
  };

  // Session-picked character per category (random each load)
  let SESSION_CHAR = {};       // { [category]: { name, rarity, image, category } }
  // Full CSV pool
  let CHAR_POOL = {};          // { [category]: Array<...> }
  // Recent activity for Boss tab
  let ACTIVITY = [];

  const STATE = loadState();
  document.addEventListener("DOMContentLoaded", init);

  // ---------- State & Storage ----------
  function loadState() {
    let s;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { s = {}; }
    return {
      tasks: s.tasks || [],
      characters: s.characters || {},        // unlocked characters (persisted)
      config: s.config || structuredClone(DEFAULT_CONFIG),
      power: s.power || 0,
      calendarCursor: s.calendarCursor || todayStr().slice(0,7), // YYYY-MM
      seedVersion: s.seedVersion || 0,
      meta: s.meta || { installedAt: Date.now(), completedCount: 0 }
    };
  }
  function save() {
    localStorage.setItem(LS_KEY, JSON.stringify(STATE));
    renderHeaderPower();
  }

  // ---------- Utilities ----------
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
  function todayStr(){ return new Date().toISOString().slice(0,10); }
  function fmtDate(iso) {
    if(!iso) return "—";
    const d = new Date(iso+"T00:00:00");
    return d.toLocaleDateString(undefined,{month:"short", day:"numeric"});
  }
  function startOfWeek(d){
    const dt = new Date(d); const day = dt.getDay(); const diff = (day+6)%7; dt.setDate(dt.getDate()-diff); return dt;
  }
  function endOfWeek(d){ const s = startOfWeek(d); const e = new Date(s); e.setDate(s.getDate()+6); return e; }
  function inRange(dateIso, a, b){
    const d = new Date(dateIso+"T00:00:00");
    const A = new Date(a); const B = new Date(b);
    return d >= A && d <= B;
  }
  function priorityScore(p){ return STATE.config.weights.priority[p] ?? 1; }
  function escapeHTML(s){ return (s||"").replace(/[&<>"']/g, m=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  const categorySlug = (cat)=> cat.toLowerCase().replace(/\s+/g,'-');

  // Neon SVG placeholder if no image available
  function defaultPortraitForCategory(cat){
    const color = {
      Fitness:"#23ffd9", Home:"#a26bff", Finance:"#ffe066", Work:"#ff33cc", Rose:"#ff6ad5", Other:"#66ff99"
    }[cat] || "#6bf";
    const svg = encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 400'>
        <defs><linearGradient id='g' x1='0' x2='1'>
          <stop stop-color='${color}' stop-opacity='.85' offset='0'/>
          <stop stop-color='#0b0f1a' offset='1'/></linearGradient></defs>
        <rect width='600' height='400' fill='url(#g)'/>
        <g fill='none' stroke='${color}' stroke-width='6' opacity='.85'>
          <rect x='40' y='40' width='520' height='320' rx='26' ry='26'/>
          <path d='M70 360L220 180 320 260 380 210 530 360'/>
        </g>
        <text x='50%' y='58%' text-anchor='middle' font-size='46' fill='white' font-family='system-ui' opacity='.9'>${cat}</text>
      </svg>`
    );
    return `data:image/svg+xml;charset=utf-8,${svg}`;
  }

  // ---------- CSV Loader (pool) ----------
  async function loadCharactersFromCSV(){
    const path = "assets/Cyberpunk App.csv"; // your CSV file path
    try{
      const res = await fetch(path, {cache:"no-store"});
      if(!res.ok) throw new Error("csv missing");
      const text = await res.text();
      const rows = text.split(/\r?\n/).map(r=>r.trim()).filter(Boolean);
      const header = rows.shift().split(",").map(x=>x.trim());
      const idx = {
        cat: header.findIndex(h=>/category/i.test(h)),
        img: header.findIndex(h=>/image/i.test(h)),
        name: header.findIndex(h=>/name/i.test(h)),
        rarity: header.findIndex(h=>/rarity/i.test(h))
      };
      const byCat = {};
      for(const row of rows){
        const cols = row.split(",").map(x=>x.trim());
        const cat = cols[idx.cat] || "Other";
        // prefer CSV image; fallback to /assets/characters/[Category]/[Category]-[1..3].png
        const csvImage = cols[idx.img] || "";
        const slug = categorySlug(cat);
        const fallbackImg = `/assets/characters/${cat}/${cat}-` + (1 + Math.floor(Math.random()*3)) + `.png`;
        const image = csvImage || fallbackImg;
        (byCat[cat] ||= []).push({
          category: cat,
          image,
          name: cols[idx.name] || `${cat} Ally`,
          rarity: cols[idx.rarity] || "R"
        });
      }
      return byCat;
    }catch(e){
      // Fallback pool (still respects your folder layout)
      const byCat = {};
      for(const cat of CATEGORIES){
        const picks = [1,2,3].map(n=>({
          category:cat,
          image:`/assets/characters/${cat}/${cat}-${n}.png`,
          name:`${cat} Operative ${n}`,
          rarity:["R","SR","SSR"][n-1] || "R"
        }));
        byCat[cat] = picks;
      }
      return byCat;
    }
  }

  // Pick one random character per category for this session
  function makeSessionCharacters(pool){
    const chosen = {};
    for(const cat of CATEGORIES){
      const list = pool[cat] || [];
      if(list.length){
        chosen[cat] = list[Math.floor(Math.random()*list.length)];
      }else{
        // ultimate fallback
        chosen[cat] = {
          category:cat,
          image: defaultPortraitForCategory(cat),
          name: `${cat} Ally`,
          rarity: "R"
        };
      }
    }
    return chosen;
  }

  // ---------- App Init ----------
  async function init(){
    // Populate category selects (quick form)
    const qCat = document.getElementById("q-category");
    qCat.innerHTML = CATEGORIES.map(c=>`<option>${c}</option>`).join("");

    setupTabs();
    setupAddDialog();
    setupTaskToolbar();
    setupCalendar();
    setupConfig();
    setupReset();

    // Load CSV pool & pick session characters
    CHAR_POOL = await loadCharactersFromCSV();
    SESSION_CHAR = makeSessionCharacters(CHAR_POOL);

    renderAll();

    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
    }
  }

  // ---------- Toasts ----------
  function toast(html){
    const layer = document.getElementById("toast-layer");
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = html;
    layer.appendChild(t);
    setTimeout(()=>{ t.remove(); }, 2300);
  }

  // ---------- Tabs ----------
  function setupTabs(){
    const tabs = document.querySelectorAll(".tabs .tab");
    tabs.forEach(btn=>{
      btn.addEventListener("click", ()=>{
        tabs.forEach(b=>b.setAttribute("aria-selected","false"));
        btn.setAttribute("aria-selected","true");
        const id = btn.dataset.tab;
        document.querySelectorAll("main > section").forEach(s=>s.hidden = !s.id.endsWith(id));
        document.getElementById("views").focus({preventScroll:true});
        if(id==="tasks") renderTasks();
        if(id==="summary") renderSummary();
        if(id==="characters") renderCharacters();
        if(id==="calendar") renderCalendar();
        if(id==="boss") renderBoss();
      });
    });
  }

  // ---------- Power & XP ----------
  function computeTaskXP(t){
    const pr = priorityScore(t.priority);
    const est = Number(t.estimate || 0);
    const streak = STATE.config.weights.streak;
    let base = pr*10 + est*STATE.config.weights.estHour*5;
    switch(STATE.config.scale){
      case "Square root": base = Math.sqrt(base)*12; break;
      case "Log": base = Math.log10(base+1)*24; break;
    }
    const streakLevel = (STATE.meta.completedCount % 7);
    base += streak * streakLevel * 2;
    return Math.max(1, Math.round(base));
  }
  function addPower(xp, source){
    STATE.power += xp;
    save();
    renderHeaderPower();
    if(source) addActivity(source, xp);
  }
  function renderHeaderPower(){
    const pct = clamp(Math.round( (STATE.power % STATE.config.bossTarget) / STATE.config.bossTarget * 100 ), 0, 100);
    document.getElementById("power-perc").textContent = `${pct}%`;
    document.getElementById("powerbar-inner").style.width = `${pct}%`;
  }
  function addActivity(title, xp){ 
    ACTIVITY.unshift({ when: new Date().toISOString(), title, xp });
    ACTIVITY = ACTIVITY.slice(0, 50);
  }

  // ---------- Summary ----------
  function renderSummary(){
    const grid = document.getElementById("summary-grid");
    grid.innerHTML = CATEGORIES.map(cat=>{
      const portrait = (SESSION_CHAR[cat]?.image) || defaultPortraitForCategory(cat);
      return `
      <button class="tile" data-cat="${cat}" aria-label="View ${cat} portrait">
        <img alt="" src="${portrait}">
        <div class="label">${cat}</div>
      </button>`;
    }).join("");
    grid.querySelectorAll(".tile").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const cat = btn.dataset.cat;
        const img = (SESSION_CHAR[cat]?.image) || defaultPortraitForCategory(cat);
        openLightbox(`<img src="${img}" alt="${cat} portrait" style="max-width:100%;border-radius:12px" />`);
      });
    });
  }

  // ---------- Quick Create ----------
  document.addEventListener("submit", (e)=>{
    if(e.target.id === "quick-form"){
      e.preventDefault();
      const t = {
        id: uid(),
        title: document.getElementById("q-title").value.trim(),
        due: document.getElementById("q-due").value || null,
        priority: document.getElementById("q-priority").value,
        category: document.getElementById("q-category").value,
        notes: document.getElementById("q-notes").value.trim(),
        type: "oneoff", start: null, end: null, repeat: null,
        estimate: 1,
        done: false,
        createdAt: new Date().toISOString()
      };
      if(!t.title){ e.target.reportValidity(); return; }
      STATE.tasks.push(t); save();
      toast(`<strong class="cyan">Task created</strong>: ${t.title}`);
      e.target.reset();
      renderTasks(); renderCalendar(); renderSummary();
    }
  });

  // ---------- Tasks ----------
  function setupTaskToolbar(){
    document.getElementById("task-search").addEventListener("input", ()=> renderTasks());
    document.getElementById("task-sort").addEventListener("change", ()=> renderTasks());
    document.querySelectorAll(".toolbar .chip[data-scope]").forEach(ch=>{
      ch.addEventListener("click", ()=>{
        document.querySelectorAll(".toolbar .chip[data-scope]").forEach(c=>c.setAttribute("aria-pressed","false"));
        ch.setAttribute("aria-pressed","true");
        renderTasks();
      });
    });

    // Category pills
    const wrap = document.getElementById("task-categories");
    wrap.innerHTML = ['All', ...CATEGORIES].map(c=>`<button class="chip" data-cat="${c}" aria-pressed="${c==='All'}">${c}</button>`).join("");
    wrap.querySelectorAll(".chip").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        wrap.querySelectorAll(".chip").forEach(b=>b.setAttribute("aria-pressed","false"));
        btn.setAttribute("aria-pressed","true");
        renderTasks();
      });
    });
  }

  function renderTasks(){
    const groupsEl = document.getElementById("task-groups");
    const search = document.getElementById("task-search").value.toLowerCase();
    const sort = document.getElementById("task-sort").value;
    const scopeBtn = document.querySelector('.toolbar .chip[aria-pressed="true"][data-scope]');
    const scope = scopeBtn?.dataset.scope || "today";
    const activeCatBtn = document.querySelector('#task-categories .chip[aria-pressed="true"]');
    const catFilter = activeCatBtn ? activeCatBtn.dataset.cat : "All";

    const now = new Date(); const start = startOfWeek(now); const end = endOfWeek(now);
    const filtered = STATE.tasks.filter(t=>{
      if(catFilter !== "All" && t.category !== catFilter) return false;
      if(search && !(t.title.toLowerCase().includes(search) || (t.notes||"").toLowerCase().includes(search))) return false;
      if(scope === "today"){ return (t.due ? t.due === todayStr() : true); }
      if(scope === "week"){ return (t.due ? inRange(t.due, start, end) : true); }
      return true;
    });

    // Stats
    const doneCount = STATE.tasks.filter(t=>t.done).length;
    const todayCount = STATE.tasks.filter(t=>t.due === todayStr() && !t.done).length;
    document.getElementById("stat-done").textContent = `Done: ${doneCount}`;
    document.getElementById("stat-today").textContent = `Due Today: ${todayCount}`;
    document.getElementById("stat-total").textContent = `Total: ${STATE.tasks.length}`;

    // Sort
    let sortFn;
    if(sort === "priority"){
      sortFn = (a,b)=> priorityScore(b.priority) - priorityScore(a.priority);
    } else if(sort === "due"){
      sortFn = (a,b)=> (a.due||"9999") .localeCompare(b.due||"9999");
    } else {
      sortFn = (a,b)=> (a.createdAt||"").localeCompare(b.createdAt||"");
    }
    filtered.sort(sortFn);

    // Group by due date
    const map = new Map();
    for(const t of filtered){
      const key = t.due || "No date";
      if(!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }

    if(filtered.length === 0){
      groupsEl.innerHTML = `<div class="card muted">No tasks match your filters.</div>`;
      return;
    }

    groupsEl.innerHTML = [...map.entries()].map(([k, arr])=>{
      const label = k==="No date" ? "No date" : `${fmtDate(k)} (${k})`;
      return `<div class="group card">
        <div class="group-head">
          <strong>${label}</strong>
          <span class="muted">${arr.length} task(s)</span>
        </div>
        <div class="group-body">${arr.map(renderTaskCard).join("")}</div>
      </div>`;
    }).join("");

    // Handlers
    groupsEl.querySelectorAll(".task").forEach(card=>{
      card.querySelector(".btn-done").addEventListener("click", ()=>{
        completeTask(card.dataset.id);
        card.classList.add("zap");
        setTimeout(()=>renderTasks(), 620);
      });
      card.querySelector(".btn-del").addEventListener("click", ()=>{
        if(confirm("Delete this task?")){
          deleteTask(card.dataset.id);
          renderTasks(); renderCalendar();
        }
      });

      let sx=0, ex=0; 
      card.addEventListener("touchstart", e=>{ sx = e.changedTouches[0].screenX; }, {passive:true});
      card.addEventListener("touchend", e=>{
        ex = e.changedTouches[0].screenX;
        const dx = ex - sx;
        if(dx > 60){ completeTask(card.dataset.id); card.classList.add("zap"); setTimeout(()=>renderTasks(), 620); }
        else if(dx < -60){ if(confirm("Delete this task?")){ deleteTask(card.dataset.id); renderTasks(); renderCalendar(); } }
      }, {passive:true});
    });
  }

  function renderTaskCard(t){
    const color = PRIORITY_COLORS[t.priority] || "#9cf";
    const done = t.done ? "done" : "";
    return `<div class="task ${done}" data-id="${t.id}">
      <div class="p-dot" style="color:${color}"></div>
      <div>
        <div class="title">${escapeHTML(t.title)}</div>
        <div class="meta">
          <span class="pill">${t.category}</span>
          <span class="pill">Priority: ${t.priority}</span>
          <span class="pill">Due: ${fmtDate(t.due)}</span>
          ${t.type!=="oneoff" ? `<span class="pill">${t.type}</span>` : ""}
          ${t.estimate ? `<span class="pill">~${t.estimate}h</span>` : ""}
        </div>
        ${t.notes ? `<div class="notes">${escapeHTML(t.notes)}</div>` : ""}
      </div>
      <div class="actions">
        <button class="btn btn-done">Done</button>
        <button class="btn btn-del">Delete</button>
      </div>
      <div class="hint"><span>← Delete</span><span>Done →</span></div>
    </div>`;
  }

  function completeTask(id){
    const t = STATE.tasks.find(x=>x.id===id);
    if(!t || t.done) return;
    t.done = true;
    STATE.meta.completedCount++;
    const xp = computeTaskXP(t);
    addPower(xp, `+${xp}XP · ${t.title}`);
    unlockCharacterMaybe(t.category, xp);
    toast(`⚡ <strong>Completed</strong>: ${escapeHTML(t.title)} <span class="muted">(+${xp} XP)</span>`);
    save();
    renderCharacters();
    renderBoss();
    renderCalendar();
  }
  function deleteTask(id){
    STATE.tasks = STATE.tasks.filter(x=>x.id!==id);
    save();
  }

  // ---------- Add Dialog ----------
  let selectedAddCategory = CATEGORIES[0];
  function setupAddDialog(){
    const dlg = document.getElementById("add-dialog");
    const openBtn = document.getElementById("fab-add");
    const cancelBtn = document.getElementById("add-cancel");
    const confirmBtn = document.getElementById("add-confirm");
    const pills = document.getElementById("a-category-pills");
    const prev = document.getElementById("a-character-preview");

    pills.innerHTML = CATEGORIES.map((c,i)=>`<button type="button" class="chip" data-cat="${c}" aria-pressed="${i===0}">${c}</button>`).join("");
    const updatePreview = ()=>{
      const img = (SESSION_CHAR[selectedAddCategory]?.image) || defaultPortraitForCategory(selectedAddCategory);
      prev.innerHTML = `<img src="${img}" alt="${selectedAddCategory} preview" style="max-width:100%;max-height:110px;border-radius:10px" />`;
    };
    pills.querySelectorAll(".chip").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        pills.querySelectorAll(".chip").forEach(b=>b.setAttribute("aria-pressed","false"));
        btn.setAttribute("aria-pressed","true");
        selectedAddCategory = btn.dataset.cat;
        updatePreview();
      });
    });
    prev.innerHTML = `<div class="muted">Character preview will appear here</div>`;

    openBtn.addEventListener("click", ()=> { dlg.showModal(); selectedAddCategory=CATEGORIES[0]; updatePreview(); });
    cancelBtn.addEventListener("click", ()=> dlg.close());
    document.getElementById("add-clear").addEventListener("click", ()=> document.getElementById("add-form").reset());

    confirmBtn.addEventListener("click", (e)=>{
      e.preventDefault();
      const title = document.getElementById("a-title").value.trim();
      if(!title){ document.getElementById("a-title").reportValidity(); return; }
      const t = {
        id: uid(),
        title,
        category: selectedAddCategory,
        priority: document.getElementById("a-priority").value,
        type: document.getElementById("a-type").value,
        start: document.getElementById("a-start").value || null,
        end: document.getElementById("a-end").value || null,
        estimate: Number(document.getElementById("a-est").value || 0),
        repeat: Number(document.getElementById("a-repeat").value || 0) || null,
        notes: document.getElementById("a-notes").value.trim(),
        due: (document.getElementById("a-end").value || document.getElementById("a-start").value || null),
        done:false, createdAt: new Date().toISOString()
      };
      STATE.tasks.push(t); save();
      dlg.close();
      toast(`<strong class="cyan">Task added</strong>: ${escapeHTML(t.title)}`);
      renderTasks(); renderCalendar(); renderSummary();
    });
  }

  // ---------- Calendar ----------
  function setupCalendar(){
    document.getElementById("cal-prev").addEventListener("click", ()=>{ shiftMonth(-1); });
    document.getElementById("cal-next").addEventListener("click", ()=>{ shiftMonth(1); });
    document.getElementById("cal-today").addEventListener("click", ()=>{ STATE.calendarCursor = todayStr().slice(0,7); save(); renderCalendar(); });
    document.getElementById("cal-generate").addEventListener("click", ()=>{ generateRecurring(); renderCalendar(); });
  }
  function shiftMonth(delta){
    const [y,m] = STATE.calendarCursor.split("-").map(n=>Number(n));
    const d = new Date(y, m-1 + delta, 1);
    STATE.calendarCursor = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    save(); renderCalendar();
  }
  function renderCalendar(){
    const grid = document.getElementById("calendar-grid");
    const title = document.getElementById("cal-title");
    const [y,m] = STATE.calendarCursor.split("-").map(n=>Number(n));
    const first = new Date(y,m-1,1);
    title.textContent = first.toLocaleString(undefined,{month:"long", year:"numeric"});

    const startDay = (first.getDay()+6)%7; // Mon=0
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells = [];
    for(let i=0;i<startDay;i++){ cells.push({blank:true}); }
    for(let d=1; d<=daysInMonth; d++){
      const iso = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const dayTasks = STATE.tasks.filter(t=>t.due===iso);
      cells.push({date: iso, tasks: dayTasks});
    }

    grid.innerHTML = cells.map(c=>{
      if(c.blank) return `<div class="day" aria-disabled="true"></div>`;
      const chips = c.tasks.slice(0,4).map(t=>{
        const color = PRIORITY_COLORS[t.priority] || "#9cf";
        return `<span class="chip-task ${t.done?'dim':''}">
          <span class="priority-dot" style="background:${color}"></span>${escapeHTML(t.title)}
        </span>`;
      }).join("");
      const dots = c.tasks.length>4 ? `<span class="dot-only" style="background:#6ea1ff"></span>` : "";
      return `<button class="day" data-date="${c.date}" aria-label="${c.date}">
        <div class="d-head"><span>${c.date.slice(-2)}</span><span class="muted">${c.tasks.length}</span></div>
        <div class="chips">${chips}${dots}</div>
      </button>`;
    }).join("");

    grid.querySelectorAll(".day[data-date]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const date = btn.dataset.date;
        const list = STATE.tasks.filter(t=>t.due===date);
        if(list.length===0){ openLightbox(`<div class="muted">No tasks on ${date}</div>`); return; }
        const html = `<h3>${date} · Tasks</h3>` + list.map(renderTaskCard).join("");
        openLightbox(html);
        const box = document.getElementById("lightbox");
        box.querySelectorAll(".task .btn-done").forEach(btn=>{
          btn.addEventListener("click", ()=>{
            const id = btn.closest(".task").dataset.id;
            completeTask(id);
            setTimeout(()=>{ renderCalendar(); renderTasks(); }, 50);
          });
        });
        box.querySelectorAll(".task .btn-del").forEach(btn=>{
          btn.addEventListener("click", ()=>{
            const id = btn.closest(".task").dataset.id;
            if(confirm("Delete this task?")){ deleteTask(id); renderCalendar(); renderTasks(); }
          });
        });
      });
    });
  }

  function generateRecurring(){
    const horizon = new Date(); horizon.setDate(horizon.getDate()+60);
    const futureIso = horizon.toISOString().slice(0,10);
    const repeats = STATE.tasks.filter(t=>t.type==="repeat" && t.repeat && t.start);
    let created = 0;
    for(const base of repeats){
      const start = new Date(base.start+"T00:00:00");
      for(let d = new Date(start); d <= horizon; d.setDate(d.getDate()+base.repeat)){
        const iso = d.toISOString().slice(0,10);
        if(iso < todayStr() || iso > futureIso) continue;
        const already = STATE.tasks.some(t=>t.title===base.title && t.due===iso);
        if(!already){
          STATE.tasks.push({...base, id: uid(), due: iso, done:false, createdAt:new Date().toISOString()});
          created++;
        }
      }
    }
    save();
    toast(created ? `Generated <strong>${created}</strong> task(s)` : `No new recurring tasks found`);
  }

  // ---------- Characters ----------
  function unlockCharacterMaybe(category, xpGained){
    // Use the session's random pick for that category
    if(!STATE.characters[category]){
      const pick = SESSION_CHAR[category] || {
        name:`${category} Ally`, image: defaultPortraitForCategory(category), rarity:"R", category
      };
      STATE.characters[category] = {
        name: pick.name, rarity: pick.rarity, category, level:1, bond: 0,
        xp: 0, xpToNext: 100, image: pick.image
      };
      toast(`🎉 <strong>Unlocked</strong>: ${pick.name} (<span class="pink">${pick.rarity}</span>)`);
    }
    const ch = STATE.characters[category];
    if(ch){
      ch.xp += Math.floor(xpGained*0.6);
      ch.bond = clamp(ch.bond + Math.floor(xpGained*0.2), 0, 100);
      while(ch.xp >= ch.xpToNext){
        ch.xp -= ch.xpToNext; ch.level++; ch.xpToNext = Math.round(ch.xpToNext*1.25);
        toast(`⬆️ <strong>${ch.name}</strong> reached <span class="yellow">Lv.${ch.level}</span>`);
      }
      save();
    }
  }

  function renderCharacters(){
    const grid = document.getElementById("chars-grid");
    const empty = document.getElementById("chars-empty");
    const entries = Object.values(STATE.characters);
    empty.style.display = entries.length ? "none" : "block";
    grid.innerHTML = entries.map(ch=>{
      return `<div class="char-card">
        <div class="char-portrait"><img alt="${ch.name} portrait" src="${ch.image||defaultPortraitForCategory(ch.category)}"></div>
        <div class="char-body">
          <div class="flex" style="justify-content:space-between">
            <div><strong>${escapeHTML(ch.name)}</strong> <span class="muted">(${ch.rarity})</span></div>
            <div class="muted">${ch.category}</div>
          </div>
          <div>Level: <strong>${ch.level}</strong> · Bond: <strong>${ch.bond}%</strong></div>
          <div class="progress" aria-label="XP"><div style="width:${Math.round(ch.xp/ch.xpToNext*100)}%"></div></div>
          <div class="flex">
            <button class="btn" data-chat="${ch.category}">Chat</button>
            <button class="btn" data-train="${ch.category}">Train</button>
            <button class="btn" data-gift="${ch.category}">Gift</button>
          </div>
        </div>
      </div>`;
    }).join("");

    grid.querySelectorAll("[data-chat]").forEach(b=> b.addEventListener("click", ()=>{
      const cat = b.getAttribute("data-chat");
      const ch = STATE.characters[cat];
      const lines = [
        `"Stay sharp. Every checkbox is a blade."`,
        `"Neon nights favor the disciplined."`,
        `"Your grind fuels our power core."`,
        `"Focus fire: one task at a time."`
      ];
      openLightbox(`<h3>${escapeHTML(ch.name)} · Chat</h3><p class="muted">${lines[Math.floor(Math.random()*lines.length)]}</p>`);
    }));
    grid.querySelectorAll("[data-train]").forEach(b=> b.addEventListener("click", ()=>{
      const cat = b.getAttribute("data-train"); const ch = STATE.characters[cat];
      ch.xp += 20; toast(`🏋️ Trained <strong>${ch.name}</strong> (+20 XP)`);
      while(ch.xp >= ch.xpToNext){ ch.xp -= ch.xpToNext; ch.level++; ch.xpToNext=Math.round(ch.xpToNext*1.25); toast(`⬆️ ${ch.name} Lv.${ch.level}`); }
      save(); renderCharacters();
    }));
    grid.querySelectorAll("[data-gift]").forEach(b=> b.addEventListener("click", ()=>{
      const cat = b.getAttribute("data-gift"); const ch = STATE.characters[cat];
      ch.bond = clamp(ch.bond + 10, 0, 100); toast(`🎁 Gifted <strong>${ch.name}</strong> (+10 bond)`);
      save(); renderCharacters();
    }));
  }

  // ---------- Boss ----------
  function renderBoss(){
    const cycle = new Date().toISOString().slice(0,7);
    document.getElementById("boss-meta").textContent = `Cycle: ${cycle}`;
    document.getElementById("boss-target").textContent = STATE.config.bossTarget;

    const pct = clamp(Math.round((STATE.power % STATE.config.bossTarget)/STATE.config.bossTarget*100), 0, 100);
    document.getElementById("party-perc").textContent = `${pct}%`;
    document.getElementById("party-inner").style.width = `${pct}%`;

    const chance = estimateWinChance(STATE.power, STATE.config.bossTarget);
    document.getElementById("boss-chance").textContent = `${Math.round(chance*100)}%`;

    const list = document.getElementById("activity-list");
    list.innerHTML = ACTIVITY.slice(0,8).map(a=>`
      <div class="flex"><span class="muted">${fmtDate(a.when.slice(0,10))}</span> · <span>${escapeHTML(a.title)}</span></div>
    `).join("") || `<div class="muted">No recent activity yet.</div>`;

    document.getElementById("btn-simulate").onclick = ()=>{
      const roll = Math.random();
      const win = roll < chance;
      const result = document.getElementById("boss-result");
      if(win){
        const reward = 50 + Math.floor(Math.random()*50);
        addPower(reward, `Boss Victory +${reward}XP`);
        result.innerHTML = `🧨 <strong class="yellow">Victory!</strong> Rewards: +${reward} XP`;
      }else{
        result.innerHTML = `💀 <span class="muted">Defeat…</span> Train more and complete tasks.`;
      }
      renderBoss();
    };
  }
  function estimateWinChance(power, target){
    const x = power - target;
    const k = 1/120;
    return 1/(1+Math.exp(-k*x));
  }

  // ---------- Config / Reset ----------
  function setupConfig(){
    const presetSel = document.getElementById("xp-preset");
    const scaleSel = document.getElementById("xp-scale");
    presetSel.value = STATE.config.xpPreset || "Default";
    scaleSel.value = STATE.config.scale || "Linear";

    presetSel.addEventListener("change", ()=>{
      const p = presetSel.value;
      STATE.config.xpPreset = p;
      if(p==="Aggressive"){ STATE.config.weights.priority={Low:1,Medium:3,High:6}; STATE.config.weights.estHour=2; STATE.config.weights.streak=1; }
      else if(p==="Gentle"){ STATE.config.weights.priority={Low:1,Medium:1.5,High:2}; STATE.config.weights.estHour=0.6; STATE.config.weights.streak=0.3; }
      else { STATE.config.weights = structuredClone(DEFAULT_CONFIG.weights); }
      save(); toast(`Preset <strong>${p}</strong> applied`);
    });
    scaleSel.addEventListener("change", ()=>{
      STATE.config.scale = scaleSel.value; save(); toast(`Scaling: <strong>${STATE.config.scale}</strong>`);
    });

    const targetInput = document.getElementById("boss-target-input");
    targetInput.value = STATE.config.bossTarget;
    document.getElementById("apply-target").addEventListener("click", ()=>{
      STATE.config.bossTarget = Math.max(10, Number(targetInput.value)||300);
      save(); renderBoss(); toast(`Boss target set to <strong>${STATE.config.bossTarget}</strong>`);
    });

    document.getElementById("seed-demo").addEventListener("click", ()=>{
      seedDemoData();
      save(); renderAll(); toast(`Seeded demo tasks & characters`);
    });
    document.getElementById("reset-all").addEventListener("click", ()=>{
      document.getElementById("confirm-reset").showModal();
    });
  }

  function setupReset(){
    const dlg = document.getElementById("confirm-reset");
    document.getElementById("reset-cancel-btn").addEventListener("click", ()=> dlg.close());
    document.getElementById("reset-confirm-btn").addEventListener("click", ()=>{
      localStorage.removeItem(LS_KEY);
      Object.assign(STATE, loadState());
      dlg.close();
      toast(`Data wiped`);
      renderAll();
    });
  }

  function seedDemoData(){
    const base = todayStr();
    const add = (title, offset, pr, cat, notes="")=>{
      const d = new Date(base+"T00:00:00"); d.setDate(d.getDate()+offset);
      STATE.tasks.push({
        id: uid(), title, due: d.toISOString().slice(0,10),
        priority: pr, category: cat, notes, type:"oneoff", estimate: Math.random()<.5?1:2,
        start:null, end:null, repeat:null, done:false, createdAt:new Date().toISOString()
      });
    };
    STATE.tasks.length = 0;
    add("30-minute run", 0, "High", "Fitness", "Zone 2, headphones");
    add("Meal prep", 1, "Medium", "Home");
    add("Invoice review", 2, "Medium", "Finance");
    add("Sprint planning", 3, "High", "Work");
    add("Call Rose", -1, "Low", "Rose");
    add("Backlog grooming", 4, "Low", "Other");

    STATE.tasks.push({
      id: uid(), title:"Daily stretch", category:"Fitness", priority:"Low",
      type:"repeat", start: base, end:null, repeat:1, estimate:0.5, notes:"5 mins",
      due: base, done:false, createdAt:new Date().toISOString()
    });

    STATE.power = 120;
    STATE.characters = {};
    ACTIVITY = [];
  }

  // ---------- Lightbox ----------
  function openLightbox(html){
    const dlg = document.getElementById("lightbox");
    document.getElementById("lightbox-content").innerHTML = html;
    dlg.showModal();
    document.getElementById("lightbox-close").onclick = ()=> dlg.close();
  }

  // ---------- Render root ----------
  function renderAll(){
    renderHeaderPower();
    renderSummary();
    renderTasks();
    renderCalendar();
    renderCharacters();
    renderBoss();
  }
})();
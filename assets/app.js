(() => {
  "use strict";

  const STORE_KEY = "qa-pool-progress-v1";
  const TYPE_LABEL = {
    theory: "Теория",
    practice: "Практика",
    situational: "Ситуация",
    personal: "О себе",
    company: "Вопросы к компании",
  };
  const ANSWER_LABEL = {
    personal: "Критерии хорошего ответа",
    company: "Что можно спросить",
  };

  const $ = (s) => document.querySelector(s);
  let DATA = null;
  let SECTIONS = {};
  let progress = loadProgress();

  // ---------- хранилище ----------
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch { /* приватный режим */ }
  }
  function setMark(id, mark) {
    if (progress[id] === mark) delete progress[id]; else progress[id] = mark;
    saveProgress();
    updateProgress();
  }

  // ---------- утилиты ----------
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // ответы уже отрендерены в HTML скриптом сборки (tools/build_questions.py)
  const md = (q) => q.answer_html || `<p>${esc(q.answer)}</p>`;
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  const freqText = (n) => `${n} ${plural(n, "собес", "собеса", "собесов")}`;
  const freqClass = (n) => (n >= 5 ? "f-hot" : n >= 3 ? "f-warm" : "");
  const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function chips(q) {
    const st = progress[q.id];
    return `<span class="chip ${freqClass(q.frequency)}" title="На скольких собесах встретился">${freqText(q.frequency)}</span>`
      + `<span class="chip">${esc(SECTIONS[q.section].title)}</span>`
      + (q.condition ? `<span class="chip cond">${q.images ? "условие и скриншот" : "есть условие"}</span>` : "")
      + (st === "known" ? `<span class="chip st-known">знаю</span>` : "")
      + (st === "repeat" ? `<span class="chip st-repeat">повторить</span>` : "");
  }

  // ---------- загрузка ----------
  fetch("data/questions.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(() => { $("#subtitle").textContent = "Не удалось загрузить вопросы. Обнови страницу."; });

  function init(data) {
    DATA = data;
    data.sections.forEach((s) => (SECTIONS[s.id] = s));
    data.questions.forEach((q) => (q._search = norm(q.question + " " + (q.condition || "") + " " + q.answer)));
    const d = new Date(data.updated);
    $("#subtitle").textContent = `${data.questions.length} ${plural(data.questions.length, "вопрос", "вопроса", "вопросов")} · обновлено ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;

    const opts = `<option value="">Все разделы</option>` + data.sections.map((s) => {
      const n = data.questions.filter((q) => q.section === s.id).length;
      return `<option value="${s.id}">${esc(s.title)} (${n})</option>`;
    }).join("");
    $("#fSection").innerHTML = opts;
    $("#tSection").innerHTML = opts;

    bindBrowse();
    bindTrain();
    bindTabs();
    updateProgress();
    renderList();
    route();
  }

  // ---------- прогресс ----------
  function updateProgress() {
    if (!DATA) return;
    const total = DATA.questions.length;
    let k = 0, r = 0;
    DATA.questions.forEach((q) => { if (progress[q.id] === "known") k++; else if (progress[q.id] === "repeat") r++; });
    document.querySelector(".pb-known").style.width = (k / total) * 100 + "%";
    document.querySelector(".pb-repeat").style.width = (r / total) * 100 + "%";
    $("#progressText").innerHTML = k || r
      ? `Знаю <b class="k">${k}</b> · повторить <b class="r">${r}</b> · не отмечено ${total - k - r} из ${total}`
      : `Отмечай вопросы как «знаю» или «повторить» — прогресс сохранится в этом браузере.`;
  }

  // ---------- просмотр ----------
  const filters = () => ({
    text: norm($("#search").value.trim()),
    section: $("#fSection").value,
    type: $("#fType").value,
    freq: +$("#fFreq").value,
    status: $("#fStatus").value,
    sort: $("#fSort").value,
  });

  function matches(q, f) {
    if (f.section && q.section !== f.section) return false;
    if (f.type && q.type !== f.type) return false;
    if (q.frequency < f.freq) return false;
    const st = progress[q.id];
    if (f.status === "none" && st) return false;
    if (f.status && f.status !== "none" && st !== f.status) return false;
    if (f.text && !f.text.split(/\s+/).every((w) => q._search.includes(w))) return false;
    return true;
  }

  function cardHTML(q, open) {
    const st = progress[q.id];
    return `<article class="card ${st ? "st-" + st : ""}" id="${q.id}">
      <details${open ? " open" : ""}>
        <summary>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
          <div class="q-main"><div class="q-text">${esc(q.question)}</div><div class="q-meta">${chips(q)}</div></div>
        </summary>
        <div class="card-body">${open ? bodyHTML(q, true) : ""}</div>
      </details>
    </article>`;
  }
  function conditionHTML(q) {
    if (!q.condition) return "";
    const imgs = (q.images || []).map((im) =>
      `<a class="shot" href="${esc(im.src)}" target="_blank" rel="noopener" title="Открыть в полном размере">
         <img src="${esc(im.src)}" alt="${esc(im.alt || "")}" loading="lazy"></a>`).join("");
    return `<div class="condition">
        <div class="answer-label cond-label">Условие задачи</div>
        <div class="answer">${q.condition_html}</div>
        ${imgs ? `<div class="shots">${imgs}</div><p class="shots-hint">Нажми на скриншот, чтобы открыть его в полном размере</p>` : ""}
      </div>`;
  }
  function bodyHTML(q, showAnswer) {
    const st = progress[q.id];
    const hide = q.condition && !showAnswer;
    return `${conditionHTML(q)}
      ${hide ? `<button class="btn primary reveal" data-reveal>Показать ответ</button>` : ""}
      <div class="answer-block"${hide ? " hidden" : ""}>
        <div class="answer-label">${ANSWER_LABEL[q.type] || "Ответ"}</div>
        <div class="answer">${md(q)}</div>
      </div>
      <div class="card-actions">
        <button class="btn small mark-repeat" data-mark="repeat" aria-pressed="${st === "repeat"}">Повторить</button>
        <button class="btn small mark-known" data-mark="known" aria-pressed="${st === "known"}">Знаю</button>
        <button class="btn small ghost copy" data-copy title="Скопировать ссылку на вопрос">Ссылка</button>
      </div>`;
  }

  function renderList() {
    const f = filters();
    const open = $("#openAll").checked;
    let qs = DATA.questions.filter((q) => matches(q, f));
    let html = "";
    if (f.sort === "freq") {
      qs = [...qs].sort((a, b) => b.frequency - a.frequency);
      html = qs.map((q) => cardHTML(q, open)).join("");
    } else {
      DATA.sections.forEach((s) => {
        const items = qs.filter((q) => q.section === s.id);
        if (!items.length) return;
        html += `<h2 class="sec-title"><span>${esc(s.title)}</span><span>${items.length}</span></h2>`;
        if (s.intro && !f.text) html += `<p class="sec-intro">${esc(s.intro)}</p>`;
        html += items.map((q) => cardHTML(q, open)).join("");
      });
    }
    $("#list").innerHTML = html;
    $("#empty").hidden = qs.length > 0;
    $("#found").textContent = `Показано: ${qs.length} из ${DATA.questions.length}`;
  }

  function refreshCard(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const q = DATA.questions.find((x) => x.id === id);
    const st = progress[id];
    el.className = `card ${st ? "st-" + st : ""}`;
    el.querySelector(".q-meta").innerHTML = chips(q);
    el.querySelectorAll("[data-mark]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mark === st));
  }

  function bindBrowse() {
    let t;
    $("#search").addEventListener("input", () => { clearTimeout(t); t = setTimeout(renderList, 150); });
    ["#fSection", "#fType", "#fFreq", "#fStatus", "#fSort", "#openAll"].forEach((s) => $(s).addEventListener("change", renderList));

    // ленивый рендер ответа при раскрытии
    $("#list").addEventListener("toggle", (e) => {
      const det = e.target;
      if (det.tagName !== "DETAILS" || !det.open) return;
      const body = det.querySelector(".card-body");
      if (!body.innerHTML.trim()) {
        const q = DATA.questions.find((x) => x.id === det.parentElement.id);
        body.innerHTML = bodyHTML(q, false);
      }
    }, true);

    $("#list").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const id = btn.closest(".card").id;
      if (btn.hasAttribute("data-reveal")) {
        btn.closest(".card-body").querySelector(".answer-block").hidden = false;
        btn.remove();
      } else if (btn.dataset.mark) {
        setMark(id, btn.dataset.mark);
        refreshCard(id);
      } else if (btn.hasAttribute("data-copy")) {
        const url = location.href.split("#")[0] + "#" + id;
        navigator.clipboard?.writeText(url).then(() => {
          btn.textContent = "Скопировано";
          setTimeout(() => (btn.textContent = "Ссылка"), 1500);
        });
      }
    });

    $("#reset").addEventListener("click", () => {
      if (!Object.keys(progress).length) return;
      progress = {};
      saveProgress();
      updateProgress();
      renderList();
    });
  }

  // ---------- вкладки и ссылки ----------
  function showView(v) {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.view === v));
    $("#view-browse").hidden = v !== "browse";
    $("#view-train").hidden = v !== "train";
  }
  function bindTabs() {
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      history.replaceState(null, "", t.dataset.view === "train" ? "#train" : location.pathname);
      showView(t.dataset.view);
      if (t.dataset.view === "train") updateAvail();
    }));
    window.addEventListener("hashchange", route);
  }
  function route() {
    const h = location.hash.slice(1);
    if (h === "train") { showView("train"); updateAvail(); return; }
    showView("browse");
    if (/^q\d+$/.test(h)) {
      const q = DATA.questions.find((x) => x.id === h);
      if (!q) return;
      if (!document.getElementById(h)) {
        ["#search", "#fSection", "#fType", "#fStatus"].forEach((s) => ($(s).value = ""));
        $("#fFreq").value = "1";
        renderList();
      }
      const el = document.getElementById(h);
      el.querySelector("details").open = true;
      el.classList.add("flash-target");
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ---------- тренировка ----------
  let deck = [], pos = 0, revealed = false, session = { known: 0, repeat: 0, repeatIds: [] };

  function trainPool() {
    const sec = $("#tSection").value, pool = $("#tPool").value;
    return DATA.questions.filter((q) => {
      if (sec && q.section !== sec) return false;
      if (pool === "unknown" && progress[q.id] === "known") return false;
      if (pool === "repeat" && progress[q.id] !== "repeat") return false;
      return true;
    });
  }
  function updateAvail() {
    const n = trainPool().length;
    $("#tAvail").textContent = n ? `Подходит вопросов: ${n}` : "Под эти условия вопросов нет — поменяй раздел или выбор.";
    $("#tStart").disabled = !n;
  }

  function startDeck(list) {
    deck = list; pos = 0;
    session = { known: 0, repeat: 0, repeatIds: [] };
    $("#trainSetup").hidden = true;
    $("#trainDone").hidden = true;
    $("#trainCard").hidden = false;
    showCard();
  }

  function showCard() {
    const q = deck[pos];
    revealed = false;
    $("#fcCounter").textContent = `${pos + 1} / ${deck.length}`;
    $("#fcMeta").innerHTML = chips(q) + `<span class="chip">${TYPE_LABEL[q.type]}</span>`;
    $("#fcQuestion").textContent = q.question;
    $("#fcCondition").innerHTML = conditionHTML(q);
    $("#fcLabel").textContent = ANSWER_LABEL[q.type] || "Эталонный ответ";
    $("#fcAnswer").innerHTML = "";
    $("#fcAnswerWrap").hidden = true;
    $("#fcReveal").hidden = false;
    $("#trainCard").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function reveal() {
    if (revealed) return;
    revealed = true;
    $("#fcAnswer").innerHTML = md(deck[pos]);
    $("#fcAnswerWrap").hidden = false;
    $("#fcReveal").hidden = true;
  }
  function answer(mark) {
    if (!revealed) return;
    const q = deck[pos];
    progress[q.id] = mark;
    saveProgress();
    updateProgress();
    session[mark]++;
    if (mark === "repeat") session.repeatIds.push(q.id);
    pos++;
    if (pos >= deck.length) finish(); else showCard();
  }
  function finish() {
    $("#trainCard").hidden = true;
    $("#trainDone").hidden = false;
    const total = session.known + session.repeat;
    $("#doneText").innerHTML = total
      ? `Пройдено ${total} ${plural(total, "вопрос", "вопроса", "вопросов")}: знаю — <b>${session.known}</b>, повторить — <b>${session.repeat}</b>.`
      : "Тренировка завершена.";
    $("#dRepeat").hidden = !session.repeatIds.length;
    renderList();
  }

  function bindTrain() {
    ["#tSection", "#tPool"].forEach((s) => $(s).addEventListener("change", updateAvail));
    $("#tStart").addEventListener("click", () => {
      let list = trainPool();
      list = $("#tOrder").value === "random"
        ? shuffle([...list])
        : shuffle([...list]).sort((a, b) => b.frequency - a.frequency);
      const n = +$("#tCount").value;
      if (n) list = list.slice(0, n);
      if (list.length) startDeck(list);
    });
    $("#fcReveal").addEventListener("click", reveal);
    $("#fcKnown").addEventListener("click", () => answer("known"));
    $("#fcRepeat").addEventListener("click", () => answer("repeat"));
    $("#fcExit").addEventListener("click", finish);
    $("#dNew").addEventListener("click", () => { $("#trainDone").hidden = true; $("#trainSetup").hidden = false; updateAvail(); });
    $("#dRepeat").addEventListener("click", () => {
      const ids = new Set(session.repeatIds);
      startDeck(shuffle(DATA.questions.filter((q) => ids.has(q.id))));
    });
    document.addEventListener("keydown", (e) => {
      if ($("#trainCard").hidden || $("#view-train").hidden) return;
      if (e.target.closest("input, select, textarea")) return;
      if (e.code === "Space" && !revealed) { e.preventDefault(); reveal(); }
      else if (e.key === "ArrowRight") answer("known");
      else if (e.key === "ArrowLeft") answer("repeat");
    });
  }
})();

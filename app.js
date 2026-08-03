const DB_NAME = "shiyue-reader";
const DB_VERSION = 1;
const BOOK_STORE = "books";
const STATE_KEY = "shiyue-settings";

const $ = (id) => document.getElementById(id);
const ui = {
  fileInput: $("fileInput"), welcome: $("welcome"), readingView: $("readingView"),
  pageText: $("pageText"), footer: $("readingFooter"), bookTitle: $("bookTitle"),
  chapterTitle: $("chapterTitle"), prev: $("prevPage"), next: $("nextPage"),
  progressText: $("progressText"), progressBar: $("progressBar"), bookList: $("bookList"),
  chapterList: $("chapterList"), chapterSection: $("chapterSection"), scrim: $("scrim"),
  libraryPanel: $("libraryPanel"), settingsPanel: $("settingsPanel"), toast: $("toast"),
  fontValue: $("fontSizeValue"), encoding: $("encodingSelect")
};

const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
const state = {
  books: [], current: null, page: 0, pages: [], chapters: [], chapterIndex: 0,
  fontSize: saved.fontSize || 20, theme: saved.theme || "paper", encoding: saved.encoding || "auto",
  pageStart: 0, pageEnd: 0, pageHistory: []
};
let resizeTimer;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(BOOK_STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbAction(mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOK_STORE, mode);
    const store = tx.objectStore(BOOK_STORE);
    const result = callback(store);
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

const getBooks = () => dbAction("readonly", store => store.getAll());
const saveBook = (book) => dbAction("readwrite", store => store.put(book));

function persistSettings() {
  localStorage.setItem(STATE_KEY, JSON.stringify({ fontSize: state.fontSize, theme: state.theme, encoding: state.encoding, currentId: state.current?.id }));
}

function decodeFile(buffer) {
  if (state.encoding !== "auto") return new TextDecoder(state.encoding).decode(buffer);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const bad = (utf8.match(/�/g) || []).length;
  if (bad === 0) return utf8.replace(/^\uFEFF/, "");
  try { return new TextDecoder("gb18030").decode(buffer); } catch { return utf8; }
}

function cleanText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "　　").replace(/\n{4,}/g, "\n\n\n").trim();
}

function findChapters(text) {
  const heading = /^(?:\s{0,4})(第[零〇一二两三四五六七八九十百千万0-9]{1,12}[章节卷回部篇集][^\n]{0,30}|(?:序章|楔子|引子|前言|后记|尾声|番外)(?:[^\n]{0,24}))\s*$/gm;
  const found = [...text.matchAll(heading)].map((match) => ({ title: match[1].trim(), start: match.index }));
  if (!found.length || found[0].start > 0) found.unshift({ title: "正文", start: 0, synthetic: true });
  return found.map((item, index) => ({ ...item, end: found[index + 1]?.start ?? text.length }));
}

function safeTextBoundary(text, offset) {
  let safe = Math.max(0, Math.min(offset, text.length));
  if (safe > 0 && safe < text.length) {
    const code = text.charCodeAt(safe);
    if (code >= 0xdc00 && code <= 0xdfff) safe--;
  }
  return safe;
}

function chapterAtStart(offset) {
  return state.chapters.find(chapter => chapter.start === offset && !chapter.synthetic);
}

function chapterBodyStart(chapter) {
  if (!chapter) return null;
  const text = state.current.text;
  const headingEnd = text.indexOf("\n", chapter.start);
  if (headingEnd < 0 || headingEnd >= chapter.end) return chapter.end;

  const normalizedTitle = chapter.title.replace(/\s+/g, "").toLowerCase();
  let cursor = headingEnd + 1;
  while (cursor < chapter.end) {
    const nextBreak = text.indexOf("\n", cursor);
    const lineEnd = nextBreak < 0 || nextBreak > chapter.end ? chapter.end : nextBreak;
    const line = text.slice(cursor, lineEnd).trim();
    const normalizedLine = line.replace(/\s+/g, "").toLowerCase();
    if (line && normalizedLine !== normalizedTitle) break;
    cursor = lineEnd < chapter.end ? lineEnd + 1 : lineEnd;
  }
  return cursor;
}

function setPageContent(start, end) {
  const text = state.current.text;
  const chapter = chapterAtStart(start);
  if (!chapter) {
    ui.pageText.textContent = text.slice(start, end);
    return;
  }
  const title = document.createElement("h2");
  title.className = "chapter-page-title";
  title.textContent = chapter.title;
  const body = document.createElement("span");
  body.textContent = text.slice(chapterBodyStart(chapter), end);
  ui.pageText.replaceChildren(title, body);
}

function fitCurrentPage(start) {
  const text = state.current.text;
  const pageStart = safeTextBoundary(text, start);
  const nextChapter = state.chapters.find(chapter => chapter.start > pageStart);
  const sectionEnd = nextChapter?.start ?? text.length;
  const firstCodePoint = text.codePointAt(pageStart);
  const chapter = chapterAtStart(pageStart);
  const firstCharacterEnd = Math.min(text.length, pageStart + (firstCodePoint > 0xffff ? 2 : 1));
  const minimumEnd = Math.min(sectionEnd, Math.max(firstCharacterEnd, chapterBodyStart(chapter) ?? firstCharacterEnd));
  const fits = (end) => {
    setPageContent(pageStart, safeTextBoundary(text, end));
    return ui.pageText.scrollHeight <= ui.pageText.clientHeight + 1;
  };

  let lower = pageStart;
  let upper = Math.min(sectionEnd, pageStart + 1800);
  while (upper < sectionEnd && fits(upper)) {
    lower = upper;
    upper = Math.min(sectionEnd, pageStart + (upper - pageStart) * 2);
  }

  let best = lower;
  while (lower <= upper) {
    const middle = safeTextBoundary(text, Math.floor((lower + upper) / 2));
    if (middle <= best && lower === upper) break;
    if (fits(middle)) {
      best = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  // Extremely small/hidden viewports still need to make forward progress.
  const end = Math.min(sectionEnd, Math.max(minimumEnd, safeTextBoundary(text, best)));
  setPageContent(pageStart, end);
  return end;
}

function paginate(keepPosition = true) {
  if (!state.current) return;
  const oldOffset = keepPosition ? state.pageStart : state.current.progress || 0;
  state.chapters = findChapters(state.current.text);
  state.pageHistory = Array.isArray(state.current.pageHistory) ? [...state.current.pageHistory] : [];
  state.page = Number.isFinite(state.current.pageNumber) ? state.current.pageNumber : state.pageHistory.length + 1;
  state.pageStart = safeTextBoundary(state.current.text, oldOffset);
  state.pageEnd = fitCurrentPage(state.pageStart);
  renderPage(false);
  renderChapters();
}

async function renderPage(save = true) {
  if (!state.current) return;
  const offset = state.pageStart;
  state.chapterIndex = Math.max(0, state.chapters.findLastIndex(ch => ch.start <= offset));
  const currentChapter = state.chapters[state.chapterIndex];
  const isChapterOpening = Boolean(chapterAtStart(offset));
  ui.bookTitle.textContent = state.current.title;
  ui.chapterTitle.textContent = currentChapter?.title || "正文";
  ui.chapterTitle.hidden = isChapterOpening;
  const percent = Math.min(100, Math.round((state.pageEnd / Math.max(1, state.current.text.length)) * 100));
  ui.progressText.textContent = `第 ${Math.max(1, state.page)} 页 · ${percent}%`;
  ui.progressBar.style.width = `${percent}%`;
  ui.prev.disabled = state.pageHistory.length === 0;
  ui.next.disabled = state.pageEnd >= state.current.text.length;
  document.querySelectorAll(".chapter-list button").forEach((el, i) => el.classList.toggle("active", i === state.chapterIndex));
  if (save) {
    state.current.progress = offset;
    state.current.pageHistory = state.pageHistory.slice(-200);
    state.current.pageNumber = state.page;
    state.current.updatedAt = Date.now();
    await saveBook(state.current);
    persistSettings();
  }
}

function showReader() {
  ui.welcome.hidden = true;
  ui.readingView.hidden = false;
  ui.footer.hidden = false;
}

async function openBook(book) {
  state.current = book;
  showReader();
  closePanels();
  requestAnimationFrame(() => paginate(false));
  persistSettings();
  renderLibrary();
}

async function importFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".txt")) return showToast("请选择 TXT 文件");
  try {
    const text = cleanText(decodeFile(await file.arrayBuffer()));
    if (!text) return showToast("这个文件没有可阅读的文字");
    const id = `${file.name}-${file.size}-${file.lastModified}`;
    const existing = state.books.find(book => book.id === id);
    const book = existing || { id, title: file.name.replace(/\.txt$/i, ""), text, progress: 0, createdAt: Date.now(), updatedAt: Date.now() };
    if (existing) book.text = text;
    await saveBook(book);
    state.books = await getBooks();
    renderLibrary();
    await openBook(book);
    showToast(existing ? "已继续上次阅读" : "已加入书架");
  } catch (error) {
    console.error(error);
    showToast("文件读取失败，请检查编码");
  } finally { ui.fileInput.value = ""; }
}

function renderLibrary() {
  const books = [...state.books].sort((a, b) => b.updatedAt - a.updatedAt);
  ui.bookList.replaceChildren(...books.map(book => {
    const button = document.createElement("button");
    button.className = `book-card${book.id === state.current?.id ? " active" : ""}`;
    button.innerHTML = `<strong></strong><small></small>`;
    button.querySelector("strong").textContent = book.title;
    button.querySelector("small").textContent = `${Math.round((book.progress / Math.max(1, book.text.length)) * 100)}% · ${new Date(book.updatedAt).toLocaleDateString("zh-CN")}`;
    button.addEventListener("click", () => openBook(book));
    return button;
  }));
  ui.chapterSection.hidden = !state.current;
}

function renderChapters() {
  ui.chapterList.replaceChildren(...state.chapters.map((chapter, i) => {
    const button = document.createElement("button");
    button.className = i === state.chapterIndex ? "active" : "";
    button.innerHTML = `<span>${String(i + 1).padStart(2, "0")}</span>`;
    button.append(document.createTextNode(chapter.title));
    button.addEventListener("click", () => {
      state.pageHistory = [];
      state.page = 1;
      state.pageStart = chapter.start;
      state.pageEnd = fitCurrentPage(state.pageStart);
      renderPage(); closePanels();
    });
    return button;
  }));
}

function turnPage(delta) {
  if (!state.current) return;
  if (delta > 0) {
    if (state.pageEnd >= state.current.text.length) return;
    state.pageHistory.push(state.pageStart);
    state.pageStart = state.pageEnd;
    state.page++;
  } else {
    if (!state.pageHistory.length) return;
    state.pageStart = state.pageHistory.pop();
    state.page = Math.max(1, state.page - 1);
  }
  state.pageEnd = fitCurrentPage(state.pageStart);
  renderPage();
}

function openPanel(panel) {
  closePanels();
  ui.scrim.hidden = false;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
}

function closePanels() {
  [ui.libraryPanel, ui.settingsPanel].forEach(panel => { panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); });
  ui.scrim.hidden = true;
}

function applySettings() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.setProperty("--font-size", `${state.fontSize}px`);
  ui.fontValue.textContent = state.fontSize;
  ui.encoding.value = state.encoding;
  document.querySelector('meta[name="theme-color"]').content = ({ paper: "#f4eddf", white: "#ffffff", green: "#dfe9dc", night: "#242628" })[state.theme];
  document.querySelectorAll("[data-theme]").forEach(el => el.classList.toggle("active", el.dataset.theme === state.theme));
  persistSettings();
}

let toastTimer;
function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1800);
}

ui.fileInput.addEventListener("change", event => importFile(event.target.files[0]));
$("libraryButton").addEventListener("click", () => openPanel(ui.libraryPanel));
$("settingsButton").addEventListener("click", () => openPanel(ui.settingsPanel));
ui.scrim.addEventListener("click", closePanels);
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", closePanels));
ui.prev.addEventListener("click", () => turnPage(-1));
ui.next.addEventListener("click", () => turnPage(1));
$("tapPrevious").addEventListener("click", event => { event.stopPropagation(); turnPage(-1); });
$("tapNext").addEventListener("click", event => { event.stopPropagation(); turnPage(1); });
function repaginateFromCurrentPosition() {
  if (!state.current) return;
  state.current.progress = state.pageStart;
  state.current.pageHistory = [];
  state.current.pageNumber = 1;
  paginate(false);
}

$("fontDown").addEventListener("click", () => { state.fontSize = Math.max(15, state.fontSize - 1); applySettings(); repaginateFromCurrentPosition(); });
$("fontUp").addEventListener("click", () => { state.fontSize = Math.min(32, state.fontSize + 1); applySettings(); repaginateFromCurrentPosition(); });
$("themeChoices").addEventListener("click", event => { if (!event.target.dataset.theme) return; state.theme = event.target.dataset.theme; applySettings(); });
ui.encoding.addEventListener("change", () => { state.encoding = ui.encoding.value; persistSettings(); });
$("reader").addEventListener("click", event => {
  if (!state.current) return;
  const x = event.clientX / innerWidth;
  if (x < .34) turnPage(-1); else if (x > .66) turnPage(1);
});
let touchStartX = 0;
let touchStartY = 0;
ui.readingView.addEventListener("touchstart", event => {
  touchStartX = event.changedTouches[0].clientX;
  touchStartY = event.changedTouches[0].clientY;
}, { passive: true });
ui.readingView.addEventListener("touchend", event => {
  const deltaX = event.changedTouches[0].clientX - touchStartX;
  const deltaY = event.changedTouches[0].clientY - touchStartY;
  if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) turnPage(deltaX < 0 ? 1 : -1);
}, { passive: true });
document.addEventListener("keydown", event => {
  if (event.key === "ArrowLeft") turnPage(-1);
  if (event.key === "ArrowRight" || event.key === " ") turnPage(1);
  if (event.key === "Escape") closePanels();
});
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(repaginateFromCurrentPosition, 180); });

async function init() {
  applySettings();
  try {
    state.books = await getBooks();
    renderLibrary();
    const last = state.books.find(book => book.id === saved.currentId) || [...state.books].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (last) await openBook(last);
  } catch (error) { console.error("无法打开本地书架", error); }
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

init();

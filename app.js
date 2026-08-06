const DB_NAME = "shiyue-reader";
const DB_VERSION = 1;
const BOOK_STORE = "books";
const STATE_KEY = "shiyue-settings";
const PROGRESS_KEY = "shiyue-progress";

const $ = (id) => document.getElementById(id);
const ui = {
  fileInput: $("fileInput"), welcome: $("welcome"), readingView: $("readingView"),
  pageText: $("pageText"), footer: $("readingFooter"), bookTitle: $("bookTitle"),
  chapterTitle: $("chapterTitle"), prev: $("prevPage"), next: $("nextPage"),
  progressText: $("progressText"), progressBar: $("progressBar"), bookList: $("homeBookList"), emptyShelf: $("emptyShelf"),
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
let bookSaveQueue = Promise.resolve();

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
const deleteBook = (id) => dbAction("readwrite", store => store.delete(id));

function queueBookSave(book) {
  // Serialize writes so a slower, older page-turn save cannot overwrite a
  // newer position. The book object stays current while queued saves drain.
  bookSaveQueue = bookSaveQueue.catch(() => {}).then(() => saveBook(book));
  return bookSaveQueue;
}

function persistSettings() {
  localStorage.setItem(STATE_KEY, JSON.stringify({ fontSize: state.fontSize, theme: state.theme, encoding: state.encoding, currentId: state.current?.id }));
}

function getProgressBackups() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); }
  catch { return {}; }
}

function checkpointProgress(book) {
  try {
    const backups = getProgressBackups();
    backups[book.id] = {
      progress: book.progress,
      pageHistory: book.pageHistory,
      pageNumber: book.pageNumber,
      updatedAt: book.updatedAt
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(backups));
  } catch (error) { console.warn("无法写入阅读位置检查点", error); }
}

function restoreCheckpoint(book) {
  const checkpoint = getProgressBackups()[book.id];
  if (!checkpoint || checkpoint.updatedAt < (book.updatedAt || 0)) return book;
  return { ...book, ...checkpoint };
}

function removeCheckpoint(id) {
  try {
    const backups = getProgressBackups();
    delete backups[id];
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(backups));
  } catch (error) { console.warn("无法删除阅读位置检查点", error); }
}

function persistCurrentPosition() {
  if (!state.current) return Promise.resolve();
  state.current.progress = state.pageStart;
  state.current.pageHistory = state.pageHistory.slice(-200);
  state.current.pageNumber = state.page;
  state.current.updatedAt = Date.now();
  persistSettings();
  // localStorage is synchronous, so this small checkpoint survives abrupt
  // mobile-PWA termination even when the larger IndexedDB write does not.
  checkpointProgress(state.current);
  return queueBookSave(state.current);
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
  // Whether a previous page exists is a property of the current text position,
  // not of pageHistory. History can legitimately be empty after a reload,
  // resize, settings change, or chapter-menu jump.
  const canGoPrevious = currentChapter && (offset > currentChapter.start || state.chapterIndex > 0);
  ui.prev.disabled = !canGoPrevious;
  ui.next.disabled = state.pageEnd >= state.current.text.length;
  document.querySelectorAll(".chapter-list button").forEach((el, i) => el.classList.toggle("active", i === state.chapterIndex));
  if (save) {
    await persistCurrentPosition();
  }
}

function showReader() {
  document.querySelector(".topbar").classList.remove("home-mode");
  ui.welcome.hidden = true;
  ui.readingView.hidden = false;
  ui.footer.hidden = false;
  $("libraryButton").hidden = false;
  $("contentsButton").hidden = false;
}

function showWelcome() {
  document.querySelector(".topbar").classList.add("home-mode");
  state.current = null;
  state.pageHistory = [];
  ui.welcome.hidden = false;
  ui.readingView.hidden = true;
  ui.footer.hidden = true;
  $("libraryButton").hidden = true;
  $("contentsButton").hidden = true;
  ui.bookTitle.textContent = "拾页";
  ui.chapterTitle.hidden = false;
  ui.chapterTitle.textContent = "你的随身中文阅读器";
  persistSettings();
}

async function openBook(book) {
  state.current = book;
  // Restore the persisted position synchronously. Pagination waits for the
  // reader to become visible, but lifecycle saves may run before that frame.
  state.pageStart = safeTextBoundary(book.text, Number.isFinite(book.progress) ? book.progress : 0);
  state.pageHistory = Array.isArray(book.pageHistory) ? [...book.pageHistory] : [];
  state.page = Number.isFinite(book.pageNumber) ? book.pageNumber : state.pageHistory.length + 1;
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
    state.books = (await getBooks()).map(restoreCheckpoint);
    renderLibrary();
    renderLibrary();
    showWelcome();
    showToast(existing ? "书籍已在书架中" : "已加入书架");
  } catch (error) {
    console.error(error);
    showToast("文件读取失败，请检查编码");
  } finally { ui.fileInput.value = ""; }
}

function renderLibrary() {
  const books = [...state.books].sort((a, b) => b.updatedAt - a.updatedAt);
  ui.bookList.replaceChildren(...books.map(book => {
    const row = document.createElement("div");
    row.className = "book-row";
    const button = document.createElement("button");
    button.className = `book-card${book.id === state.current?.id ? " active" : ""}`;
    button.innerHTML = `<strong></strong><small></small>`;
    button.querySelector("strong").textContent = book.title;
    button.querySelector("small").textContent = `${Math.round((book.progress / Math.max(1, book.text.length)) * 100)}% · ${new Date(book.updatedAt).toLocaleDateString("zh-CN")}`;
    button.addEventListener("click", () => openBook(book));
    const remove = document.createElement("button");
    remove.className = "book-delete";
    remove.type = "button";
    remove.setAttribute("aria-label", `删除《${book.title}》`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removeBook(book));
    row.append(button, remove);
    return row;
  }));
  ui.emptyShelf.hidden = books.length > 0;
  ui.chapterSection.hidden = !state.current;
}

function pageStartsForChapter(index) {
  const chapter = state.chapters[index];
  if (!chapter) return [];
  const starts = [];
  let cursor = chapter.start;
  let safety = 0;
  while (cursor < chapter.end && safety++ < state.current.text.length) {
    starts.push(cursor);
    const next = fitCurrentPage(cursor);
    if (next <= cursor) break;
    cursor = next;
  }
  return starts;
}

function previousPageStart() {
  const chapterIndex = state.chapters.findLastIndex(chapter => chapter.start <= state.pageStart);
  const chapter = state.chapters[chapterIndex];
  if (!chapter) return null;

  // At a chapter opening, the adjacent page is the final page of the previous
  // chapter. This is the only case in which Previous crosses a chapter border.
  if (state.pageStart === chapter.start) {
    if (chapterIndex === 0) return null;
    return pageStartsForChapter(chapterIndex - 1).at(-1) ?? null;
  }

  // Recreate this chapter's stable page boundaries. This remains correct when
  // persisted history is missing or belongs to an older viewport/font size.
  let cursor = chapter.start;
  let safety = 0;
  while (cursor < state.pageStart && safety++ < state.current.text.length) {
    const next = fitCurrentPage(cursor);
    if (next <= cursor || next >= state.pageStart) return cursor;
    cursor = next;
  }
  return null;
}

async function removeBook(book) {
  if (!window.confirm(`确定从书架删除《${book.title}》吗？\n\n阅读记录也会一并删除。`)) return;
  await deleteBook(book.id);
  removeCheckpoint(book.id);
  const wasCurrent = state.current?.id === book.id;
  state.books = (await getBooks()).map(restoreCheckpoint);
  if (wasCurrent) {
    const nextBook = [...state.books].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (nextBook) await openBook(nextBook);
    else showWelcome();
  }
  renderLibrary();
  showToast("已从书架删除");
}

function renderChapters() {
  ui.chapterList.replaceChildren(...state.chapters.map((chapter, i) => {
    const button = document.createElement("button");
    button.className = i === state.chapterIndex ? "active" : "";
    button.innerHTML = `<span>${String(i + 1).padStart(2, "0")}</span>`;
    button.append(document.createTextNode(chapter.title));
    button.addEventListener("click", () => {
      // A menu jump follows chapter order, not navigation history. From the
      // opening of chapter 9, "上一页" should be the last page of chapter 8.
      state.pageHistory = pageStartsForChapter(i - 1);
      state.page = state.pageHistory.length + 1;
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
    const previousStart = previousPageStart();
    if (previousStart === null) return;
    state.pageStart = previousStart;
    // Keep persisted history consistent, but never use it to decide where the
    // Previous button goes.
    state.pageHistory = state.pageHistory.filter(start => start < previousStart);
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

async function clearAppCache() {
  if (!navigator.onLine) {
    showToast("请联网后再刷新缓存");
    return;
  }
  const button = $("clearCacheButton");
  button.disabled = true;
  button.textContent = "正在刷新…";
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.filter(key => key.startsWith("shiyue-")).map(key => caches.delete(key)));
    }
    showToast("缓存已清除，正在重新载入");
    setTimeout(() => {
      const refreshedUrl = new URL(window.location.href);
      refreshedUrl.searchParams.set("refresh", Date.now().toString());
      window.location.replace(refreshedUrl.href);
    }, 700);
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = "刷新应用缓存";
    showToast("缓存刷新失败，请稍后重试");
  }
}

ui.fileInput.addEventListener("change", async event => {
  const files = [...event.target.files];
  for (const file of files) await importFile(file);
});
$("libraryButton").addEventListener("click", () => {
  closePanels();
  showWelcome();
  renderLibrary();
});
$("contentsButton").addEventListener("click", () => {
  if (!state.current) return;
  ui.chapterSection.hidden = false;
  renderChapters();
  openPanel(ui.libraryPanel);
  requestAnimationFrame(() => ui.chapterList.querySelector("button.active")?.scrollIntoView({ block: "center" }));
});
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
$("clearCacheButton").addEventListener("click", clearAppCache);
$("reader").addEventListener("click", event => {
  if (!state.current) return;
  const x = event.clientX / innerWidth;
  if (x < .34) turnPage(-1); else if (x > .66) turnPage(1);
});
document.addEventListener("keydown", event => {
  // Keep the reader at a stable scale. The viewport declaration handles
  // mobile browsers; these guards cover desktop shortcuts and trackpads.
  if ((event.ctrlKey || event.metaKey) && ["+", "-", "=", "0"].includes(event.key)) {
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowLeft") turnPage(-1);
  if (event.key === "ArrowRight" || event.key === " ") turnPage(1);
  if (event.key === "Escape") closePanels();
});
document.addEventListener("wheel", event => {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false });
document.addEventListener("dblclick", event => event.preventDefault(), { passive: false });
["gesturestart", "gesturechange", "gestureend"].forEach(type => {
  document.addEventListener(type, event => event.preventDefault(), { passive: false });
});
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(repaginateFromCurrentPosition, 180); });

async function init() {
  applySettings();
  try {
    state.books = (await getBooks()).map(restoreCheckpoint);
    const lastBook = state.books.find(book => book.id === saved.currentId);
    if (lastBook) await openBook(lastBook);
    else {
      renderLibrary();
      showWelcome();
    }
  } catch (error) { console.error("无法打开本地书架", error); }
}

// Start an IndexedDB write while the page is still alive. This covers app
// updates, tab closes, and mobile browsers suspending the installed PWA.
window.addEventListener("pagehide", () => { persistCurrentPosition().catch(console.error); });

// Register immediately. Waiting until after the IndexedDB work above can miss
// the load event on fast devices, leaving the app without an offline cache.
if ("serviceWorker" in navigator) {
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", async () => {
    // A newly activated worker owns the page now. Reload once so the visible
    // app also switches to the files that worker cached during installation.
    if (wasControlled && !refreshing) {
      refreshing = true;
      try { await persistCurrentPosition(); } catch (error) {
        console.error("无法在应用更新前保存阅读位置", error);
      }
      window.location.reload();
    }
  });

  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(registration => {
    const checkForUpdate = () => {
      if (navigator.onLine) registration.update().catch(error => {
        console.warn("无法检查应用更新", error);
      });
    };

    checkForUpdate();
    window.addEventListener("online", checkForUpdate);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  }).catch(error => {
    console.error("无法启用离线模式", error);
  });
}

init();

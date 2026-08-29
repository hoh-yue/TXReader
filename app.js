const DB_NAME = "shiyue-reader";
const APP_VERSION = "v42";
const DB_VERSION = 2;
const BOOK_STORE = "books";
const PROGRESS_STORE = "progress";
const STATE_KEY = "shiyue-settings";
const PROGRESS_KEY = "shiyue-progress";
const PROGRESS_SAVE_DELAY = 750;
const RESIZE_DEBOUNCE = 180;
const MIN_FONT_SIZE = 15;
const MAX_FONT_SIZE = 32;
const THEME_COLORS = {
  paper: "#f4eddf",
  white: "#ffffff",
  green: "#dfe9dc",
  night: "#242628",
};

const $ = (id) => document.getElementById(id);
const ui = {
  fileInput: $("fileInput"),
  welcome: $("welcome"),
  readingView: $("readingView"),
  pageText: $("pageText"),
  footer: $("readingFooter"),
  bookTitle: $("bookTitle"),
  chapterTitle: $("chapterTitle"),
  prev: $("prevPage"),
  next: $("nextPage"),
  progressText: $("progressText"),
  progressBar: $("progressBar"),
  bookList: $("homeBookList"),
  emptyShelf: $("emptyShelf"),
  chapterList: $("chapterList"),
  chapterSection: $("chapterSection"),
  scrim: $("scrim"),
  libraryPanel: $("libraryPanel"),
  settingsPanel: $("settingsPanel"),
  toast: $("toast"),
  fontValue: $("fontSizeValue"),
  encoding: $("encodingSelect"),
  reader: $("reader"),
  libraryButton: $("libraryButton"),
  contentsButton: $("contentsButton"),
  settingsButton: $("settingsButton"),
  tapPrevious: $("tapPrevious"),
  tapNext: $("tapNext"),
  fontDown: $("fontDown"),
  fontUp: $("fontUp"),
  themeChoices: $("themeChoices"),
  clearCacheButton: $("clearCacheButton"),
  checkUpdateButton: $("checkUpdateButton"),
  appVersion: $("appVersion"),
  topbar: document.querySelector(".topbar"),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  themeButtons: document.querySelectorAll("[data-theme]"),
  closeButtons: document.querySelectorAll("[data-close]"),
};

const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
const state = {
  books: [],
  current: null,
  page: 0,
  pages: [],
  chapters: [],
  chapterIndex: 0,
  fontSize: saved.fontSize || 20,
  theme: saved.theme || "night",
  encoding: saved.encoding || "auto",
  pageStart: 0,
  pageEnd: 0,
  pageHistory: [],
  layoutKey: "",
};
let resizeTimer;
let progressSaveTimer;
let progressSaveQueue = Promise.resolve();
let isClearingData = false;
let serviceWorkerRegistration = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOK_STORE))
        db.createObjectStore(BOOK_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PROGRESS_STORE))
        db.createObjectStore(PROGRESS_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbAction(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = callback(store);
    tx.oncomplete = () => {
      db.close();
      resolve(result?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

const getProgressRecords = () =>
  dbAction(PROGRESS_STORE, "readonly", (store) => store.getAll());
const saveBook = (book) =>
  dbAction(BOOK_STORE, "readwrite", (store) => store.put(book));
const saveProgress = (progress) =>
  dbAction(PROGRESS_STORE, "readwrite", (store) => store.put(progress));

async function getBookRecord(id) {
  return dbAction(BOOK_STORE, "readonly", (store) => store.get(id));
}

async function getBooks() {
  const [books, progressRecords] = await Promise.all([
    getBookSummaries(),
    getProgressRecords(),
  ]);
  const progressById = new Map(
    progressRecords.map((progress) => [progress.id, progress]),
  );
  // Keep only lightweight metadata in the shelf. Full text is loaded when a
  // book is opened, which prevents several large books staying in memory.
  return books.map((book) => ({
    id: book.id,
    title: book.title,
    // getBookSummaries intentionally does not load the full text. Use the
    // stored summary length so opening the app does not fail on every book.
    textLength: Number.isFinite(book.textLength) ? book.textLength : 0,
    createdAt: book.createdAt,
    progress: 0,
    updatedAt: book.createdAt || Date.now(),
    ...progressById.get(book.id),
  }));
}

function getBookSummaries() {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const tx = db.transaction(BOOK_STORE, "readonly");
      const summaries = [];
      const request = tx.objectStore(BOOK_STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const book = cursor.value;
        summaries.push({
          id: book.id,
          title: book.title,
          textLength:
            typeof book.text === "string"
              ? book.text.length
              : book.textLength || 0,
          createdAt: book.createdAt,
        });
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(summaries);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

async function loadBookForReading(book) {
  const [record, progressRecords] = await Promise.all([
    getBookRecord(book.id),
    getProgressRecords(),
  ]);
  if (!record) throw new Error("找不到这本书");
  const progress = progressRecords.find((item) => item.id === book.id);
  return { ...record, ...book, ...progress };
}

async function deleteBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([BOOK_STORE, PROGRESS_STORE], "readwrite");
    tx.objectStore(BOOK_STORE).delete(id);
    tx.objectStore(PROGRESS_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function resetLibraryProgress() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([BOOK_STORE, PROGRESS_STORE], "readwrite");
    tx.objectStore(PROGRESS_STORE).clear();
    const request = tx.objectStore(BOOK_STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.update({
        ...cursor.value,
        progress: 0,
        pageHistory: [],
        pageNumber: 1,
        layoutKey: "",
      });
      cursor.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function progressRecord(book) {
  return {
    id: book.id,
    progress: book.progress,
    pageHistory: book.pageHistory,
    pageNumber: book.pageNumber,
    layoutKey: book.layoutKey,
    updatedAt: book.updatedAt,
  };
}

function queueProgressSave(book, immediate = false) {
  clearTimeout(progressSaveTimer);
  const enqueue = () => {
    const snapshot = progressRecord(book);
    progressSaveQueue = progressSaveQueue
      .catch(() => {})
      .then(() => saveProgress(snapshot));
    return progressSaveQueue;
  };
  if (immediate) return enqueue();
  progressSaveTimer = setTimeout(enqueue, PROGRESS_SAVE_DELAY);
  return Promise.resolve();
}

function persistSettings() {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({
      fontSize: state.fontSize,
      theme: state.theme,
      encoding: state.encoding,
      currentId: state.current?.id,
    }),
  );
}

function getProgressBackups() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
  } catch {
    return {};
  }
}

function checkpointProgress(book) {
  try {
    const backups = getProgressBackups();
    backups[book.id] = {
      progress: book.progress,
      pageHistory: book.pageHistory,
      pageNumber: book.pageNumber,
      updatedAt: book.updatedAt,
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(backups));
  } catch (error) {
    console.warn("无法写入阅读位置检查点", error);
  }
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
  } catch (error) {
    console.warn("无法删除阅读位置检查点", error);
  }
}

function currentLayoutKey() {
  return `${ui.pageText.clientWidth}x${ui.pageText.clientHeight}:${state.fontSize}`;
}

function persistCurrentPosition(immediate = false) {
  if (!state.current) return Promise.resolve();
  state.current.progress = state.pageStart;
  state.current.pageHistory = state.pageHistory.slice(-200);
  state.current.pageNumber = state.page;
  state.current.layoutKey = state.layoutKey;
  state.current.updatedAt = Date.now();
  const summary = state.books.find((book) => book.id === state.current.id);
  if (summary)
    Object.assign(summary, {
      progress: state.current.progress,
      pageHistory: state.current.pageHistory,
      pageNumber: state.current.pageNumber,
      layoutKey: state.current.layoutKey,
      updatedAt: state.current.updatedAt,
    });
  persistSettings();
  // localStorage is synchronous, so this small checkpoint survives abrupt
  // mobile-PWA termination even when the larger IndexedDB write does not.
  checkpointProgress(state.current);
  return queueProgressSave(state.current, immediate);
}

function decodeFile(buffer) {
  if (state.encoding !== "auto")
    return new TextDecoder(state.encoding).decode(buffer);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const bad = (utf8.match(/�/g) || []).length;
  if (bad === 0) return utf8.replace(/^\uFEFF/, "");
  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return utf8;
  }
}

function cleanText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "　　")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function findChapters(text) {
  const heading =
    /^(?:\s{0,4})(第[零〇一二两三四五六七八九十百千万0-9]{1,12}[章节卷回部篇集][^\n]{0,30}|(?:序章|楔子|引子|前言|后记|尾声|番外)(?:[^\n]{0,24}))\s*$/gm;
  const found = [...text.matchAll(heading)].map((match) => ({
    title: match[1].trim(),
    start: match.index,
  }));
  if (!found.length || found[0].start > 0)
    found.unshift({ title: "正文", start: 0, synthetic: true });
  return found.map((item, index) => ({
    ...item,
    end: found[index + 1]?.start ?? text.length,
  }));
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
  return state.chapters.find(
    (chapter) => chapter.start === offset && !chapter.synthetic,
  );
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
    const lineEnd =
      nextBreak < 0 || nextBreak > chapter.end ? chapter.end : nextBreak;
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
  const nextChapter = state.chapters.find(
    (chapter) => chapter.start > pageStart,
  );
  const sectionEnd = nextChapter?.start ?? text.length;
  const firstCodePoint = text.codePointAt(pageStart);
  const chapter = chapterAtStart(pageStart);
  const firstCharacterEnd = Math.min(
    text.length,
    pageStart + (firstCodePoint > 0xffff ? 2 : 1),
  );
  const minimumEnd = Math.min(
    sectionEnd,
    Math.max(firstCharacterEnd, chapterBodyStart(chapter) ?? firstCharacterEnd),
  );
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
  const end = Math.min(
    sectionEnd,
    Math.max(minimumEnd, safeTextBoundary(text, best)),
  );
  setPageContent(pageStart, end);
  return end;
}

function paginate(keepPosition = true) {
  if (!state.current) return;
  const oldOffset = keepPosition
    ? state.pageStart
    : state.current.progress || 0;
  state.chapters = findChapters(state.current.text);
  state.layoutKey = currentLayoutKey();
  const layoutMatches = state.current.layoutKey === state.layoutKey;
  state.pageHistory =
    layoutMatches && Array.isArray(state.current.pageHistory)
      ? [...state.current.pageHistory]
      : [];
  state.pageStart = safeTextBoundary(state.current.text, oldOffset);
  state.pageEnd = fitCurrentPage(state.pageStart);
  if (layoutMatches && Number.isFinite(state.current.pageNumber)) {
    state.page = Math.max(1, state.current.pageNumber);
  } else {
    const pageLength = Math.max(1, state.pageEnd - state.pageStart);
    state.page = Math.max(1, Math.round(state.pageStart / pageLength) + 1);
  }
  renderPage(false);
}

async function renderPage(save = true) {
  if (!state.current) return;
  const offset = state.pageStart;
  state.chapterIndex = Math.max(
    0,
    state.chapters.findLastIndex((ch) => ch.start <= offset),
  );
  const currentChapter = state.chapters[state.chapterIndex];
  const isChapterOpening = Boolean(chapterAtStart(offset));
  ui.bookTitle.textContent = state.current.title;
  ui.chapterTitle.textContent = currentChapter?.title || "正文";
  ui.chapterTitle.hidden = isChapterOpening;
  const percent = Math.min(
    100,
    Math.round((state.pageEnd / Math.max(1, state.current.text.length)) * 100),
  );
  ui.progressText.textContent = `第 ${Math.max(1, state.page)} 页 · ${percent}%`;
  ui.progressBar.style.width = `${percent}%`;
  // Whether a previous page exists is a property of the current text position,
  // not of pageHistory. History can legitimately be empty after a reload,
  // resize, settings change, or chapter-menu jump.
  const canGoPrevious =
    currentChapter && (offset > currentChapter.start || state.chapterIndex > 0);
  ui.prev.disabled = !canGoPrevious;
  ui.next.disabled = state.pageEnd >= state.current.text.length;
  document
    .querySelectorAll(".chapter-list button")
    .forEach((el, i) =>
      el.classList.toggle("active", i === state.chapterIndex),
    );
  if (save) {
    await persistCurrentPosition();
  }
}

function showReader() {
  ui.topbar.classList.remove("home-mode");
  ui.welcome.hidden = true;
  ui.readingView.hidden = false;
  ui.footer.hidden = false;
  ui.libraryButton.hidden = false;
  ui.contentsButton.hidden = false;
}

function showWelcome() {
  ui.topbar.classList.add("home-mode");
  state.current = null;
  state.pageHistory = [];
  ui.welcome.hidden = false;
  ui.readingView.hidden = true;
  ui.footer.hidden = true;
  ui.libraryButton.hidden = true;
  ui.contentsButton.hidden = true;
  ui.bookTitle.textContent = "拾页";
  ui.chapterTitle.hidden = false;
  ui.chapterTitle.textContent = "你的随身中文阅读器";
  persistSettings();
}

async function openBook(book) {
  if (!book.text) book = await loadBookForReading(book);
  state.current = book;
  // Restore the persisted position synchronously. Pagination waits for the
  // reader to become visible, but lifecycle saves may run before that frame.
  state.pageStart = safeTextBoundary(
    book.text,
    Number.isFinite(book.progress) ? book.progress : 0,
  );
  state.pageHistory = Array.isArray(book.pageHistory)
    ? [...book.pageHistory]
    : [];
  state.page = Number.isFinite(book.pageNumber)
    ? book.pageNumber
    : state.pageHistory.length + 1;
  showReader();
  closePanels();
  requestAnimationFrame(() => paginate(false));
  persistSettings();
  renderLibrary();
}

async function importFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".txt"))
    return showToast("请选择 TXT 文件");
  try {
    const text = cleanText(decodeFile(await file.arrayBuffer()));
    if (!text) return showToast("这个文件没有可阅读的文字");
    const id = `${file.name}-${file.size}-${file.lastModified}`;
    const existing = state.books.find((book) => book.id === id);
    const book = existing
      ? { ...(await loadBookForReading(existing)), text }
      : {
          id,
          title: file.name.replace(/\.txt$/i, ""),
          text,
          progress: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
    await saveBook(book);
    const summary = {
      id: book.id,
      title: book.title,
      textLength: book.text.length,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt || book.createdAt,
      progress: Number.isFinite(book.progress) ? book.progress : 0,
      pageHistory: Array.isArray(book.pageHistory) ? book.pageHistory : [],
      pageNumber: Number.isFinite(book.pageNumber) ? book.pageNumber : 1,
      layoutKey: book.layoutKey || "",
    };
    state.books = [summary, ...state.books.filter((item) => item.id !== book.id)].map(restoreCheckpoint);
    renderLibrary();
    showWelcome();
    showToast(existing ? "书籍已在书架中" : "已加入书架");
  } catch (error) {
    console.error(error);
    showToast(`文件读取失败：${error?.message || "请检查编码或应用存储"}`);
  } finally {
    ui.fileInput.value = "";
  }
}

function renderLibrary() {
  const books = [...state.books].sort((a, b) => b.updatedAt - a.updatedAt);
  ui.bookList.replaceChildren(
    ...books.map((book) => {
      const row = document.createElement("div");
      row.className = "book-row";
      const button = document.createElement("button");
      button.className = `book-card${book.id === state.current?.id ? " active" : ""}`;
      button.innerHTML = `<strong></strong><small></small>`;
      button.querySelector("strong").textContent = book.title;
      const progress = Number.isFinite(book.progress) ? book.progress : 0;
      const textLength = Number.isFinite(book.textLength) ? book.textLength : 0;
      const progressPercent =
        textLength > 0
          ? Math.min(
              100,
              Math.max(0, Math.round((progress / textLength) * 100)),
            )
          : 0;
      const updatedAt = Number.isFinite(book.updatedAt)
        ? book.updatedAt
        : book.createdAt;
      const dateText = Number.isFinite(updatedAt)
        ? new Date(updatedAt).toLocaleDateString("zh-CN")
        : "日期未知";
      button.querySelector("small").textContent =
        `${progressPercent}% · ${dateText}`;
      button.addEventListener("click", () => openBook(book));
      const remove = document.createElement("button");
      remove.className = "book-delete";
      remove.type = "button";
      remove.setAttribute("aria-label", `删除《${book.title}》`);
      remove.textContent = "×";
      remove.addEventListener("click", () => removeBook(book));
      row.append(button, remove);
      return row;
    }),
  );
  ui.emptyShelf.hidden = books.length > 0;
  ui.chapterSection.hidden = !state.current;
}

function previousPageStart() {
  const cached = state.pageHistory.at(-1);
  if (Number.isFinite(cached) && cached < state.pageStart) return cached;

  const chapterIndex = state.chapters.findLastIndex(
    (chapter) => chapter.start <= state.pageStart,
  );
  const chapter = state.chapters[chapterIndex];
  if (!chapter) return null;

  // At a chapter opening, the adjacent page is the final page of the previous
  // chapter. This is the only case in which Previous crosses a chapter border.
  if (state.pageStart === chapter.start) {
    if (chapterIndex === 0) return null;
    const previousChapter = state.chapters[chapterIndex - 1];
    let cursor = previousChapter.start;
    let previous = cursor;
    while (cursor < previousChapter.end) {
      previous = cursor;
      const next = fitCurrentPage(cursor);
      if (next <= cursor) break;
      cursor = next;
    }
    return previous;
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
  if (
    !window.confirm(
      `确定从书架删除《${book.title}》吗？\n\n阅读记录也会一并删除。`,
    )
  )
    return;
  await deleteBook(book.id);
  removeCheckpoint(book.id);
  const wasCurrent = state.current?.id === book.id;
  state.books = (await getBooks()).map(restoreCheckpoint);
  if (wasCurrent) {
    const nextBook = [...state.books].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )[0];
    if (nextBook) await openBook(nextBook);
    else showWelcome();
  }
  renderLibrary();
  showToast("已从书架删除");
}

function renderChapters() {
  let chapterNumber = 0;
  ui.chapterList.replaceChildren(
    ...state.chapters.map((chapter, i) => {
      if (!chapter.synthetic) chapterNumber++;
      const button = document.createElement("button");
      button.className = i === state.chapterIndex ? "active" : "";
      const number = chapter.synthetic
        ? "—"
        : String(chapterNumber).padStart(2, "0");
      button.innerHTML = `<span>${number}</span>`;
      button.append(document.createTextNode(chapter.title));
      button.addEventListener("click", () => {
        // A menu jump has no reusable navigation history. Estimate its page
        // number from this layout instead of forcing every earlier page to fit.
        state.pageHistory = [];
        state.pageStart = chapter.start;
        state.pageEnd = fitCurrentPage(state.pageStart);
        const pageLength = Math.max(1, state.pageEnd - state.pageStart);
        state.page = Math.max(1, Math.round(state.pageStart / pageLength) + 1);
        renderPage();
        closePanels();
      });
      return button;
    }),
  );
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
    // Consume the cached adjacent boundary when one was available.
    state.pageHistory.pop();
    state.page = Math.max(1, state.page - 1);
  }
  state.pageEnd = fitCurrentPage(state.pageStart);
  renderPage();
  animatePageTurn(delta);
}

function animatePageTurn(delta) {
  const className = delta > 0 ? "slide-next" : "slide-previous";
  ui.pageText.classList.remove("slide-next", "slide-previous");
  // Force a reflow so consecutive quick swipes restart the animation.
  void ui.pageText.offsetWidth;
  ui.pageText.classList.add(className);
}

function openPanel(panel) {
  closePanels();
  ui.scrim.hidden = false;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
}

function closePanels() {
  [ui.libraryPanel, ui.settingsPanel].forEach((panel) => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  });
  ui.scrim.hidden = true;
}

function applySettings() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.setProperty(
    "--font-size",
    `${state.fontSize}px`,
  );
  ui.appVersion.textContent = APP_VERSION;
  ui.fontValue.textContent = state.fontSize;
  ui.encoding.value = state.encoding;
  ui.themeColor.content = THEME_COLORS[state.theme];
  ui.themeButtons.forEach((el) =>
    el.classList.toggle("active", el.dataset.theme === state.theme),
  );
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
  const confirmed = window.confirm(
    "确定清除应用数据吗？\n\n所有书籍会保留，但阅读进度将重置到第一页。显示设置和离线缓存也会被清除。",
  );
  if (!confirmed) return;

  const button = ui.clearCacheButton;
  button.disabled = true;
  button.textContent = "正在清除…";
  isClearingData = true;
  clearTimeout(progressSaveTimer);
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(
        keys
          .filter((key) => key.startsWith("shiyue-"))
          .map((key) => caches.delete(key)),
      );
    }
    localStorage.clear();
    await resetLibraryProgress();
    showToast("应用数据已清除，书籍已保留");
    setTimeout(() => {
      const refreshedUrl = new URL(window.location.href);
      refreshedUrl.searchParams.set("refresh", Date.now().toString());
      window.location.replace(refreshedUrl.href);
    }, 700);
  } catch (error) {
    console.error(error);
    isClearingData = false;
    button.disabled = false;
    button.textContent = "清除应用数据（保留书籍）";
    showToast("数据清除失败，请关闭其他窗口后重试");
  }
}

function bindPrimaryControls() {
  ui.fileInput.addEventListener("change", async (event) => {
    const files = [...event.target.files];
    for (const file of files) await importFile(file);
  });
  ui.libraryButton.addEventListener("click", () => {
    closePanels();
    showWelcome();
    renderLibrary();
  });
  ui.contentsButton.addEventListener("click", () => {
    if (!state.current) return;
    ui.chapterSection.hidden = false;
    renderChapters();
    openPanel(ui.libraryPanel);
    requestAnimationFrame(() =>
      ui.chapterList
        .querySelector("button.active")
        ?.scrollIntoView({ block: "center" }),
    );
  });
  ui.settingsButton.addEventListener("click", () =>
    openPanel(ui.settingsPanel),
  );
  ui.scrim.addEventListener("click", closePanels);
  ui.closeButtons.forEach((button) =>
    button.addEventListener("click", closePanels),
  );
  ui.prev.addEventListener("click", () => turnPage(-1));
  ui.next.addEventListener("click", () => turnPage(1));
  ui.tapPrevious.addEventListener("click", (event) => {
    event.stopPropagation();
    turnPage(-1);
  });
  ui.tapNext.addEventListener("click", (event) => {
    event.stopPropagation();
    turnPage(1);
  });
}

// Own horizontal gestures on the reading surface so mobile browsers do not
// interpret an edge swipe as history navigation. Calling preventDefault from
// touchstart also suppresses the synthetic click, so short taps are handled
// here and mouse/keyboard clicks continue to use the listeners above.
function bindReaderGestures() {
  const readingView = ui.readingView;
  let readerTouch = null;

  readingView.addEventListener(
    "touchstart",
    (event) => {
      if (!state.current || event.touches.length !== 1) {
        readerTouch = null;
        return;
      }
      const touch = event.touches[0];
      readerTouch = { x: touch.clientX, y: touch.clientY };
      event.preventDefault();
    },
    { passive: false },
  );

  readingView.addEventListener(
    "touchmove",
    (event) => {
      if (!readerTouch || event.touches.length !== 1) return;
      event.preventDefault();
    },
    { passive: false },
  );

  readingView.addEventListener(
    "touchend",
    (event) => {
      if (!readerTouch || event.changedTouches.length !== 1) {
        readerTouch = null;
        return;
      }

      event.preventDefault();
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - readerTouch.x;
      const deltaY = touch.clientY - readerTouch.y;
      const swipeDistance = Math.min(72, Math.max(44, innerWidth * 0.12));

      if (
        Math.abs(deltaX) >= swipeDistance &&
        Math.abs(deltaX) > Math.abs(deltaY) * 1.25
      ) {
        turnPage(deltaX < 0 ? 1 : -1);
      } else if (Math.hypot(deltaX, deltaY) < 12) {
        const tapPosition = touch.clientX / innerWidth;
        if (tapPosition < 0.34) turnPage(-1);
        else if (tapPosition > 0.66) turnPage(1);
      }
      readerTouch = null;
    },
    { passive: false },
  );

  readingView.addEventListener(
    "touchcancel",
    () => {
      readerTouch = null;
    },
    { passive: false },
  );
}

function repaginateFromCurrentPosition() {
  if (!state.current) return;
  state.current.progress = state.pageStart;
  state.current.pageHistory = [];
  state.current.layoutKey = "";
  paginate(false);
}

function bindPreferenceAndGlobalControls() {
  ui.fontDown.addEventListener("click", () => {
    state.fontSize = Math.max(MIN_FONT_SIZE, state.fontSize - 1);
    applySettings();
    repaginateFromCurrentPosition();
  });
  ui.fontUp.addEventListener("click", () => {
    state.fontSize = Math.min(MAX_FONT_SIZE, state.fontSize + 1);
    applySettings();
    repaginateFromCurrentPosition();
  });
  ui.themeChoices.addEventListener("click", (event) => {
    if (!event.target.dataset.theme) return;
    state.theme = event.target.dataset.theme;
    applySettings();
  });
  ui.encoding.addEventListener("change", () => {
    state.encoding = ui.encoding.value;
    persistSettings();
  });
  ui.clearCacheButton.addEventListener("click", clearAppCache);
  ui.checkUpdateButton.addEventListener("click", async () => {
    if (!serviceWorkerRegistration) {
      showToast("离线服务尚未准备好");
      return;
    }
    if (!navigator.onLine) {
      showToast("当前处于离线状态，无法检查更新");
      return;
    }
    const button = ui.checkUpdateButton;
    button.disabled = true;
    button.textContent = "正在检查…";
    try {
      await serviceWorkerRegistration.update();
      button.textContent = `已是最新版本 ${APP_VERSION}`;
      showToast(`已是最新版本 ${APP_VERSION}`);
    } catch (error) {
      console.warn("无法检查应用更新", error);
      button.textContent = "检查失败，请重试";
      showToast("检查更新失败，请确认网络连接");
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "检查更新";
      }, 1800);
    }
  });
  ui.reader.addEventListener("click", (event) => {
    if (!state.current) return;
    const x = event.clientX / innerWidth;
    if (x < 0.34) turnPage(-1);
    else if (x > 0.66) turnPage(1);
  });
  document.addEventListener("keydown", (event) => {
    // Keep the reader at a stable scale. The viewport declaration handles
    // mobile browsers; these guards cover desktop shortcuts and trackpads.
    if (
      (event.ctrlKey || event.metaKey) &&
      ["+", "-", "=", "0"].includes(event.key)
    ) {
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowLeft") turnPage(-1);
    if (event.key === "ArrowRight" || event.key === " ") turnPage(1);
    if (event.key === "Escape") closePanels();
  });
  document.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener("dblclick", (event) => event.preventDefault(), {
    passive: false,
  });
  ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
    document.addEventListener(type, (event) => event.preventDefault(), {
      passive: false,
    });
  });
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(repaginateFromCurrentPosition, RESIZE_DEBOUNCE);
  });
}

function bindEvents() {
  bindPrimaryControls();
  bindReaderGestures();
  bindPreferenceAndGlobalControls();
}

async function init() {
  applySettings();
  try {
    state.books = (await getBooks()).map(restoreCheckpoint);
    const lastBook = state.books.find((book) => book.id === saved.currentId);
    if (lastBook) await openBook(lastBook);
    else {
      renderLibrary();
      showWelcome();
    }
  } catch (error) {
    console.error("无法打开本地书架", error);
  }
}

// Start an IndexedDB write while the page is still alive. This covers app
// updates, tab closes, and mobile browsers suspending the installed PWA.
window.addEventListener("pagehide", () => {
  if (!isClearingData) persistCurrentPosition(true).catch(console.error);
});
document.addEventListener("visibilitychange", () => {
  if (!isClearingData && document.visibilityState === "hidden")
    persistCurrentPosition(true).catch(console.error);
});

// Register immediately. Waiting until after the IndexedDB work above can miss
// the load event on fast devices, leaving the app without an offline cache.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then((registration) => {
      serviceWorkerRegistration = registration;
    })
    .catch((error) => {
      console.error("无法启用离线模式", error);
    });
}

bindEvents();
init();

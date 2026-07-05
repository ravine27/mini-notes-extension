document.addEventListener("DOMContentLoaded", () => {
  const dom = {
    searchInput: document.getElementById("searchInput"),
    notesList: document.getElementById("notesList"),
    titleInput: document.getElementById("titleInput"),
    contentInput: document.getElementById("contentInput"),
    newNoteBtn: document.getElementById("newNoteBtn"),
    saveNoteBtn: document.getElementById("saveNoteBtn"),
    deleteNoteBtn: document.getElementById("deleteNoteBtn"),
    statusMessage: document.getElementById("statusMessage"),
    noteItemTemplate: document.getElementById("noteItemTemplate")
  };

  if (Object.values(dom).some((node) => !node) || !chrome?.storage?.sync) {
    return;
  }

  const state = {
    notes: [],
    selectedNoteId: null,
    query: "",
    autoSaveTimerId: null,
    statusTimerId: null
  };

  const STORAGE_KEYS = {
    notes: "notes",
    selectedNoteId: "selectedNoteId"
  };

  initialize().catch((error) => {
    console.error(error);
    setStatus("Failed to initialize notes.", true);
  });

  async function initialize() {
    await loadStateFromStorage();
    bindEvents();
    render();
  }

  function bindEvents() {
    dom.searchInput.addEventListener("input", onSearchInput);
    dom.titleInput.addEventListener("input", onEditorInput);
    dom.contentInput.addEventListener("input", onEditorInput);

    dom.newNoteBtn.addEventListener("click", onCreateNote);
    dom.saveNoteBtn.addEventListener("click", onSaveNoteClick);
    dom.deleteNoteBtn.addEventListener("click", onDeleteNoteClick);

    dom.notesList.addEventListener("click", onNoteSelectClick);
    dom.notesList.addEventListener("keydown", onNoteSelectKeydown);
  }

  async function onSearchInput(event) {
    state.query = event.target.value.trim().toLowerCase();
    renderNotesList();
  }

  function onEditorInput() {
    clearTimeout(state.autoSaveTimerId);
    state.autoSaveTimerId = setTimeout(() => {
      saveSelectedNote({ silent: true }).catch((error) => {
        console.error(error);
        setStatus("Auto-save failed.", true);
      });
    }, 350);
  }

  async function onCreateNote() {
    const newNote = createNoteModel();
    state.notes = [newNote, ...state.notes];
    state.selectedNoteId = newNote.id;
    await persistNotesAndSelection();
    render();
    dom.titleInput.focus();
    setStatus("New note created.");
  }

  async function onSaveNoteClick() {
    await saveSelectedNote({ silent: false });
  }

  async function onDeleteNoteClick() {
    if (!state.selectedNoteId) {
      return;
    }

    const previousLength = state.notes.length;
    state.notes = state.notes.filter((note) => note.id !== state.selectedNoteId);

    if (state.notes.length === 0) {
      const fallbackNote = createNoteModel();
      state.notes = [fallbackNote];
      state.selectedNoteId = fallbackNote.id;
    } else {
      state.selectedNoteId = state.notes[0].id;
    }

    if (state.notes.length === previousLength) {
      return;
    }

    await persistNotesAndSelection();
    render();
    setStatus("Note deleted.");
  }

  async function onNoteSelectClick(event) {
    const button = event.target.closest("button[data-note-id]");
    if (!button) {
      return;
    }

    await selectNote(button.dataset.noteId);
  }

  async function onNoteSelectKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const button = event.target.closest("button[data-note-id]");
    if (!button) {
      return;
    }

    event.preventDefault();
    await selectNote(button.dataset.noteId);
  }

  async function selectNote(noteId) {
    if (!noteId || state.selectedNoteId === noteId) {
      return;
    }

    if (!state.notes.some((note) => note.id === noteId)) {
      return;
    }

    state.selectedNoteId = noteId;
    await persistSelectedNoteId();
    render();
  }

  async function saveSelectedNote({ silent }) {
    const selectedNote = getSelectedNote();
    if (!selectedNote) {
      return;
    }

    const nextTitle = dom.titleInput.value;
    const nextContent = dom.contentInput.value;
    const changed = selectedNote.title !== nextTitle || selectedNote.content !== nextContent;

    if (!changed) {
      if (!silent) {
        setStatus("No changes to save.");
      }
      return;
    }

    selectedNote.title = nextTitle;
    selectedNote.content = nextContent;
    selectedNote.updatedAt = Date.now();

    sortNotes();
    await persistNotesAndSelection();
    renderNotesList();

    if (!silent) {
      setStatus("Saved.");
    }
  }

  function render() {
    renderNotesList();
    renderEditor();
    renderActionState();
  }

  function renderNotesList() {
    const filteredNotes = getFilteredNotes();
    dom.notesList.textContent = "";

    if (filteredNotes.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = state.notes.length === 0 ? "No notes yet." : "No matching notes.";
      dom.notesList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const note of filteredNotes) {
      const noteNode = dom.noteItemTemplate.content.firstElementChild.cloneNode(true);
      const button = noteNode.querySelector(".note-select-btn");
      const title = noteNode.querySelector(".note-item-title");
      const preview = noteNode.querySelector(".note-item-preview");

      button.dataset.noteId = note.id;
      button.setAttribute("aria-selected", String(note.id === state.selectedNoteId));

      if (note.id === state.selectedNoteId) {
        button.classList.add("is-selected");
      }

      title.textContent = getDisplayTitle(note);
      preview.textContent = getDisplayPreview(note.content);

      fragment.appendChild(noteNode);
    }

    dom.notesList.appendChild(fragment);
  }

  function renderEditor() {
    const selected = getSelectedNote();
    if (!selected) {
      dom.titleInput.value = "";
      dom.contentInput.value = "";
      return;
    }

    if (dom.titleInput.value !== selected.title) {
      dom.titleInput.value = selected.title;
    }

    if (dom.contentInput.value !== selected.content) {
      dom.contentInput.value = selected.content;
    }
  }

  function renderActionState() {
    const hasSelection = Boolean(getSelectedNote());
    dom.saveNoteBtn.disabled = !hasSelection;
    dom.deleteNoteBtn.disabled = !hasSelection;
  }

  async function loadStateFromStorage() {
    const data = await storageGet([STORAGE_KEYS.notes, STORAGE_KEYS.selectedNoteId]);
    const loadedNotes = Array.isArray(data[STORAGE_KEYS.notes]) ? data[STORAGE_KEYS.notes] : [];

    state.notes = loadedNotes.map(normalizeNote).filter(Boolean);
    sortNotes();

    const loadedSelectedId = typeof data[STORAGE_KEYS.selectedNoteId] === "string"
      ? data[STORAGE_KEYS.selectedNoteId]
      : null;

    if (loadedSelectedId && state.notes.some((note) => note.id === loadedSelectedId)) {
      state.selectedNoteId = loadedSelectedId;
    } else {
      state.selectedNoteId = state.notes[0]?.id || null;
    }

    if (!state.selectedNoteId) {
      const initialNote = createNoteModel();
      state.notes = [initialNote];
      state.selectedNoteId = initialNote.id;
      await persistNotesAndSelection();
    }
  }

  function getSelectedNote() {
    return state.notes.find((note) => note.id === state.selectedNoteId) || null;
  }

  function getFilteredNotes() {
    if (!state.query) {
      return state.notes;
    }

    return state.notes.filter((note) => {
      const title = note.title.toLowerCase();
      const content = note.content.toLowerCase();
      return title.includes(state.query) || content.includes(state.query);
    });
  }

  function sortNotes() {
    state.notes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function normalizeNote(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const title = typeof value.title === "string" ? value.title : "";
    const content = typeof value.content === "string" ? value.content : "";
    const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
    const updatedAt = Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt;

    return {
      id: typeof value.id === "string" && value.id ? value.id : createId(),
      title,
      content,
      createdAt,
      updatedAt
    };
  }

  function createNoteModel() {
    const now = Date.now();
    return {
      id: createId(),
      title: "",
      content: "",
      createdAt: now,
      updatedAt: now
    };
  }

  function createId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getDisplayTitle(note) {
    const title = note.title.trim();
    if (title) {
      return title;
    }

    const firstLine = note.content.trim().split("\n")[0];
    return firstLine ? firstLine.slice(0, 40) : "Untitled";
  }

  function getDisplayPreview(content) {
    const text = content.trim().replace(/\s+/g, " ");
    return text ? text.slice(0, 60) : "Empty note";
  }

  function setStatus(message, isError = false) {
    clearTimeout(state.statusTimerId);
    dom.statusMessage.textContent = message;
    dom.statusMessage.classList.toggle("is-error", isError);

    if (!message || isError) {
      return;
    }

    state.statusTimerId = setTimeout(() => {
      if (dom.statusMessage.textContent === message) {
        dom.statusMessage.textContent = "";
        dom.statusMessage.classList.remove("is-error");
      }
    }, 1600);
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(result);
      });
    });
  }

  function storageSet(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  async function persistNotesAndSelection() {
    await storageSet({
      [STORAGE_KEYS.notes]: state.notes,
      [STORAGE_KEYS.selectedNoteId]: state.selectedNoteId
    });
  }

  async function persistSelectedNoteId() {
    await storageSet({
      [STORAGE_KEYS.selectedNoteId]: state.selectedNoteId
    });
  }
});

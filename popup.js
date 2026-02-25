const SAVE_AS_DIALOG = true;
const DEFAULT_BASENAME = "Kaltura_Video";
const FALLBACK_PREFIX = "video";
const FALLBACK_TOKEN_LENGTH = 8;
const DEFAULT_THEME = "system";

const STORAGE_KEYS = {
  theme: "themePreference",
  downloadCount: "downloadCount",
  lastDownloadAt: "lastDownloadAt",
};

const statusEl = document.getElementById("status");
const selectorWrapEl = document.getElementById("selectorWrap");
const segmentSelectEl = document.getElementById("segmentSelect");
const downloadBtn =
  document.getElementById("dlBtn") || document.getElementById("debt");
const versionEl = document.getElementById("version");
const videoNameEl = document.getElementById("videoName");
const tabDownloadEl = document.getElementById("tabDownload");
const tabSettingsEl = document.getElementById("tabSettings");
const panelDownloadEl = document.getElementById("panelDownload");
const panelSettingsEl = document.getElementById("panelSettings");
const downloadReadyContentEl = document.getElementById("downloadReadyContent");
const emptyStateEl = document.getElementById("emptyState");
const themeSelectEl = document.getElementById("themeSelect");
const themeButtons = Array.from(
  document.querySelectorAll(".theme-btn[data-theme-value]"),
);
const downloadCountEl = document.getElementById("downloadCount");
const lastDownloadAtEl = document.getElementById("lastDownloadAt");

let activeTab = null;
let captures = [];
let resolvedVideoName = "";
let themePreference = DEFAULT_THEME;
let downloadCount = 0;
let lastDownloadAt = null;
let activePanel = "download";

const prefersDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function getCaptureKey(tabId) {
  return `captures:${tabId}`;
}

function setStatus(text, tone = "success") {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
  }
}

function setVideoName(text) {
  if (!videoNameEl) {
    return;
  }
  videoNameEl.textContent = text || "Detecting lecture...";
}

function sanitizeFilename(value) {
  if (!value) {
    return DEFAULT_BASENAME;
  }

  return (
    value
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140) || DEFAULT_BASENAME
  );
}

function buildRandomToken(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function buildFallbackTitle() {
  return `${FALLBACK_PREFIX}-${buildRandomToken(FALLBACK_TOKEN_LENGTH)}`;
}

function resolveThemeBase(theme) {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  return prefersDarkQuery.matches ? "dark" : "light";
}

function applyTheme() {
  const baseTheme = resolveThemeBase(themePreference);
  document.documentElement.dataset.theme = baseTheme;
}

function syncThemeControls() {
  if (themeSelectEl) {
    themeSelectEl.value = themePreference;
  }

  for (const button of themeButtons) {
    const value = button.dataset.themeValue;
    button.setAttribute("aria-pressed", String(value === themePreference));
  }
}

async function setThemePreference(nextTheme) {
  const normalized = ["system", "light", "dark"].includes(nextTheme)
    ? nextTheme
    : DEFAULT_THEME;
  themePreference = normalized;
  applyTheme();
  syncThemeControls();
  await persistThemeSettings();
}

function setActiveTab(tabName) {
  activePanel = tabName === "settings" ? "settings" : "download";
  const showDownload = activePanel === "download";

  if (panelDownloadEl) {
    panelDownloadEl.hidden = !showDownload;
  }
  if (panelSettingsEl) {
    panelSettingsEl.hidden = showDownload;
  }
  if (tabDownloadEl) {
    tabDownloadEl.setAttribute("aria-selected", String(showDownload));
  }
  if (tabSettingsEl) {
    tabSettingsEl.setAttribute("aria-selected", String(!showDownload));
  }
}

function formatLastDownload(ts) {
  if (!ts) {
    return "Never";
  }
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) {
    return "Never";
  }
  return parsed.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderStats() {
  if (downloadCountEl) {
    downloadCountEl.textContent = String(downloadCount);
  }
  if (lastDownloadAtEl) {
    lastDownloadAtEl.textContent = formatLastDownload(lastDownloadAt);
  }
}

async function persistThemeSettings() {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.theme]: themePreference,
  });
}

async function persistStats() {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.downloadCount]: downloadCount,
    [STORAGE_KEYS.lastDownloadAt]: lastDownloadAt,
  });
}

async function recordDownloadSuccess() {
  downloadCount = Number(downloadCount || 0) + 1;
  lastDownloadAt = Date.now();
  renderStats();
  try {
    await persistStats();
  } catch (error) {
    // Download has already started; keep UX success status even if stat sync fails.
  }
}

function isGenericPageTitle(title) {
  const normalized = (title || "").trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "media gallery" ||
    normalized === "media gallery | canvas" ||
    normalized === "canvas | media gallery"
  );
}

function resolveDownloadBaseName(lectureTitle, fallbackTitle) {
  if (!lectureTitle || isGenericPageTitle(lectureTitle)) {
    return fallbackTitle;
  }

  const sanitized = sanitizeFilename(lectureTitle);
  if (!sanitized || sanitized === DEFAULT_BASENAME) {
    return fallbackTitle;
  }

  return sanitized;
}

function getSelectedCapture() {
  const selectedIndex = segmentSelectEl.selectedIndex;
  if (selectedIndex < 0 || selectedIndex >= captures.length) {
    return null;
  }
  return captures[selectedIndex];
}

async function getLectureTitle(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectors = [".span9 h1", "#lecture_Panel #LectureHeader h2"];

        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent && el.textContent.trim()) {
            return el.textContent.trim();
          }
        }

        const ogTitle = document.querySelector(
          "meta[property='og:title']",
        )?.content;
        if (ogTitle && ogTitle.trim()) {
          return ogTitle.trim();
        }

        return document.title || "";
      },
    });

    return results?.[0]?.result || "";
  } catch (error) {
    return "";
  }
}

async function resolveAndDisplayVideoName() {
  if (!activeTab?.id) {
    resolvedVideoName = buildFallbackTitle();
    setVideoName(resolvedVideoName);
    return;
  }

  const detectedTitle = await getLectureTitle(activeTab.id);
  const fallbackTitle = buildFallbackTitle();
  resolvedVideoName = resolveDownloadBaseName(detectedTitle, fallbackTitle);
  setVideoName(resolvedVideoName);
}

async function downloadSelected() {
  const selected = getSelectedCapture();
  if (!selected || !activeTab?.id) {
    setStatus("No stream candidate available for download.", "error");
    return;
  }

  if (!resolvedVideoName) {
    await resolveAndDisplayVideoName();
  }

  const downloadUrl = selected.url;
  const extension = "mp4";

  try {
    await chrome.downloads.download({
      url: downloadUrl,
      filename: `${resolvedVideoName}.${extension}`,
      saveAs: SAVE_AS_DIALOG,
    });
    await recordDownloadSuccess();
    setStatus(`Download started: ${resolvedVideoName}.${extension}`, "success");
  } catch (error) {
    setStatus("Download failed. Check permissions or candidate validity.", "error");
  }
}

function setDownloadContentState(hasCandidates) {
  if (downloadReadyContentEl) {
    downloadReadyContentEl.classList.toggle("hidden", !hasCandidates);
  }
  if (emptyStateEl) {
    emptyStateEl.classList.toggle("hidden", hasCandidates);
  }
  if (downloadBtn) {
    downloadBtn.disabled = !hasCandidates;
  }
}

function renderCandidates() {
  segmentSelectEl.innerHTML = "";
  captures.forEach((item, idx) => {
    const option = document.createElement("option");
    const typeTag = item.mediaType === "audio" ? "[Audio]" : "[Video]";
    option.value = item.id;
    option.textContent = `${idx + 1}. ${typeTag} ${item.label}`;
    segmentSelectEl.appendChild(option);
  });

  if (selectorWrapEl) {
    selectorWrapEl.classList.remove("hidden");
  }
  setDownloadContentState(true);
  setStatus(`Detected ${captures.length} stream candidate(s).`, "success");
}

function showNoCandidatesState() {
  setDownloadContentState(false);
  if (selectorWrapEl) {
    selectorWrapEl.classList.add("hidden");
  }
}

async function loadSettingsState() {
  const stored = await chrome.storage.sync.get([
    STORAGE_KEYS.theme,
    STORAGE_KEYS.downloadCount,
    STORAGE_KEYS.lastDownloadAt,
  ]);

  const storedTheme = stored[STORAGE_KEYS.theme];
  themePreference = ["system", "light", "dark"].includes(storedTheme)
    ? storedTheme
    : DEFAULT_THEME;
  downloadCount = Number(stored[STORAGE_KEYS.downloadCount] || 0);
  lastDownloadAt = stored[STORAGE_KEYS.lastDownloadAt] || null;

  applyTheme();
  syncThemeControls();
  renderStats();
}

function registerUIEvents() {
  if (downloadBtn) {
    downloadBtn.addEventListener("click", downloadSelected);
  }

  if (tabDownloadEl) {
    tabDownloadEl.addEventListener("click", () => setActiveTab("download"));
  }
  if (tabSettingsEl) {
    tabSettingsEl.addEventListener("click", () => setActiveTab("settings"));
  }

  if (themeSelectEl) {
    themeSelectEl.addEventListener("change", async (event) => {
      await setThemePreference(event.target.value);
    });
  }

  for (const button of themeButtons) {
    button.addEventListener("click", async () => {
      await setThemePreference(button.dataset.themeValue);
    });
  }

  const onSystemThemeChange = () => {
    if (themePreference === "system") {
      applyTheme();
    }
  };

  if (typeof prefersDarkQuery.addEventListener === "function") {
    prefersDarkQuery.addEventListener("change", onSystemThemeChange);
  } else if (typeof prefersDarkQuery.addListener === "function") {
    prefersDarkQuery.addListener(onSystemThemeChange);
  }
}

async function init() {
  registerUIEvents();
  setActiveTab("download");

  try {
    await loadSettingsState();
  } catch (error) {
    themePreference = DEFAULT_THEME;
    downloadCount = 0;
    lastDownloadAt = null;
    applyTheme();
    renderStats();
  }

  const manifestVersion = chrome.runtime.getManifest().version;
  if (versionEl) {
    versionEl.textContent = `v${manifestVersion}`;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs?.[0] || null;

  if (!activeTab?.id) {
    setStatus("Unable to detect active tab.", "waiting");
    showNoCandidatesState();
    return;
  }

  const key = getCaptureKey(activeTab.id);
  const result = await chrome.storage.local.get([key]);
  captures = Array.isArray(result[key]) ? result[key] : [];

  if (!captures.length) {
    setStatus("No stream candidates detected yet. Play the lecture first.", "waiting");
    showNoCandidatesState();
    return;
  }

  renderCandidates();
  await resolveAndDisplayVideoName();
}

init();

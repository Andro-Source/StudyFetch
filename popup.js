const SAVE_AS_DIALOG = true;
const DEFAULT_BASENAME = "Kaltura_Video";
const FALLBACK_PREFIX = "video";
const FALLBACK_TOKEN_LENGTH = 8;

const statusEl = document.getElementById("status");
const selectorWrapEl = document.getElementById("selectorWrap");
const segmentSelectEl = document.getElementById("segmentSelect");
const downloadBtn = document.getElementById("dlBtn");
const versionEl = document.getElementById("version");

let activeTab = null;
let captures = [];

function getCaptureKey(tabId) {
  return `captures:${tabId}`;
}

function setStatus(text) {
  statusEl.textContent = text;
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

function isGenericPageTitle(title) {
  const normalized = (title || "").trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "media gallery" ||
    normalized === "media gallery | canvas" ||
    normalized === "canvas | media gallery"
  );
}

function resolveDownloadBaseName(lectureTitle) {
  const fallbackTitle = buildFallbackTitle();
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
        const selectors = [
          "#span9 #entryTitle h1",
          "#lecture_Panel #LectureHeader h2",
        ];

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

async function downloadSelected() {
  const selected = getSelectedCapture();
  if (!selected || !activeTab?.id) {
    setStatus("No stream candidate available for download.");
    return;
  }

  const downloadUrl = selected.url;
  const extension = "mp4";

  const lectureTitle = await getLectureTitle(activeTab.id);
  const safeBase = resolveDownloadBaseName(lectureTitle);

  try {
    await chrome.downloads.download({
      url: downloadUrl,
      filename: `${safeBase}.${extension}`,
      saveAs: SAVE_AS_DIALOG,
    });
    setStatus(`Download started: ${safeBase}.${extension}`);
  } catch (error) {
    setStatus("Download failed. Check permissions or candidate validity.");
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

  selectorWrapEl.classList.remove("hidden");
  setStatus(`Detected ${captures.length} stream candidate(s).`);
}

async function init() {
  const manifestVersion = chrome.runtime.getManifest().version;
  versionEl.textContent = `v${manifestVersion}`;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs?.[0] || null;

  if (!activeTab?.id) {
    setStatus("Unable to detect active tab.");
    return;
  }

  const key = getCaptureKey(activeTab.id);
  const result = await chrome.storage.local.get([key]);
  captures = Array.isArray(result[key]) ? result[key] : [];

  if (!captures.length) {
    setStatus("No stream candidates detected yet. Play the lecture first.");
    return;
  }

  renderCandidates();
}

downloadBtn.addEventListener("click", downloadSelected);

init();

function getCaptureKey(tabId) {
  return `captures:${tabId}`;
}

function clearTabCaptures(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  chrome.storage.local.remove(getCaptureKey(tabId));
  chrome.action.setBadgeText({ text: "", tabId });
}

function buildPreviewLabel(sourceUrl, index) {
  const flavorMatch = sourceUrl.match(/\/flavorId\/([^/]+)/i);
  if (flavorMatch) {
    return `${flavorMatch[1]}`;
  }

  const nameMatch = sourceUrl.match(/\/name\/([^/]+)/i);
  if (nameMatch) {
    return decodeURIComponent(nameMatch[1]);
  }

  return `Candidate ${index + 1}`;
}

function isAudioStream(sourceUrl) {
  return /\/audio\//i.test(sourceUrl) || /audio/i.test(sourceUrl);
}

function isLikelyMediaRequest(sourceUrl) {
  return /\/scf\/hls\/|\/hls\/|\/serveFlavor\/|\/seg-|\/segment\/|\/chunklist|\/frag-|\.m3u8(\?|$)|\.ts(\?|$)/i.test(
    sourceUrl,
  );
}

function buildDownloadUrl(sourceUrl) {
  if (!isLikelyMediaRequest(sourceUrl)) {
    return null;
  }

  const queryIndex = sourceUrl.indexOf("?");
  const sourceQuery = queryIndex >= 0 ? sourceUrl.slice(queryIndex) : "";
  let downloadUrl =
    queryIndex >= 0 ? sourceUrl.slice(0, queryIndex) : sourceUrl;

  if (downloadUrl.includes("/scf/hls/")) {
    downloadUrl = downloadUrl.replace("/scf/hls/", "/pd/");
  } else if (/\/hls\//i.test(downloadUrl)) {
    downloadUrl = downloadUrl.replace(/\/hls\//i, "/pd/");
  }

  downloadUrl = downloadUrl
    .split("/seg-")[0]
    .split("/segment/")[0]
    .split("/chunklist")[0]
    .split("/frag-")[0];

  downloadUrl = downloadUrl
    .replace(/\/(master|playlist|index)\.m3u8$/i, "")
    .replace(/\.ts$/i, "")
    .replace(/\.m3u8$/i, "")
    .replace(/\/$/, "");

  if (!downloadUrl) {
    return null;
  }

  const isPd = /\/pd\//i.test(downloadUrl);
  const isMp4 = /\.mp4$/i.test(downloadUrl);
  if (!isPd && !isMp4) {
    return null;
  }

  if (!downloadUrl.includes("?") && sourceQuery) {
    downloadUrl = `${downloadUrl}${sourceQuery}`;
  }

  return downloadUrl;
}

function captureIdentity(url) {
  return url.split("?")[0].toLowerCase();
}

function resolveTargetTabId(details, callback) {
  if (Number.isInteger(details.tabId) && details.tabId >= 0) {
    callback(details.tabId);
    return;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    callback(Number.isInteger(tabId) ? tabId : -1);
  });
}

function storeCapture(targetTabId, downloadUrl, sourceUrl) {
  const captureKey = getCaptureKey(targetTabId);
  const candidateKey = captureIdentity(downloadUrl);

  chrome.storage.local.get([captureKey], (result) => {
    const captures = Array.isArray(result[captureKey])
      ? result[captureKey]
      : [];
    const exists = captures.some(
      (item) => captureIdentity(item.url) === candidateKey,
    );
    if (exists) {
      return;
    }

    const nextIndex = captures.length;
    captures.push({
      id: `${Date.now()}-${nextIndex}`,
      url: downloadUrl,
      sourceUrl,
      label: buildPreviewLabel(sourceUrl, nextIndex),
      mediaType: isAudioStream(sourceUrl) ? "audio" : "video",
    });

    chrome.storage.local.set({ [captureKey]: captures });
    chrome.action.setBadgeText({
      text: String(captures.length),
      tabId: targetTabId,
    });
    chrome.action.setBadgeBackgroundColor({
      color: "#4CAF50",
      tabId: targetTabId,
    });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabCaptures(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  clearTabCaptures(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearTabCaptures(tabId);
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const sourceUrl = details.url;
    const downloadUrl = buildDownloadUrl(sourceUrl);
    if (!downloadUrl) {
      return;
    }

    resolveTargetTabId(details, (targetTabId) => {
      if (targetTabId < 0) {
        return;
      }

      storeCapture(targetTabId, downloadUrl, sourceUrl);
    });
  },
  {
    urls: [
      "*://*.kaltura.com/*",
      "*://*.podcast.ucsd.edu/*",
      "*://canvas.ucsd.edu/*",
      "*://canvaskaf.ucsd.edu/*",
    ],
  },
);

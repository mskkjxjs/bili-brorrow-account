let borrowActive = false;
let retryTimer = null;

function selectHighestQuality() {
  const qualityItems = document.querySelectorAll(
    ".bpx-player-ctrl-quality-menu .bpx-player-ctrl-quality-menu-item"
  );
  const target = qualityItems[0];
  if (!target) {
    return false;
  }

  if (!target.classList.contains("bpx-state-active")) {
    target.click();
  }
  return true;
}

function selectHighestAudio() {
  const dolbyButton = document.querySelector(".bpx-player-ctrl-dolby");
  if (dolbyButton && !dolbyButton.classList.contains("bpx-state-active")) {
    dolbyButton.click();
    return true;
  }

  const hiResButton = document.querySelector(".bpx-player-ctrl-flac");
  if (hiResButton && !hiResButton.classList.contains("bpx-state-active")) {
    hiResButton.click();
    return true;
  }

  return false;
}

function applyBestPlayback() {
  try {
    const qualitySelected = selectHighestQuality();
    const audioSelected = selectHighestAudio();
    return qualitySelected || audioSelected;
  } catch {
    return false;
  }
}

function retrySelect(delay = 500, maxAttempts = 20) {
  clearTimeout(retryTimer);
  let attempts = 0;

  function attempt() {
    if (!borrowActive || attempts >= maxAttempts) {
      return;
    }

    if (applyBestPlayback()) {
      return;
    }

    const wait = Math.min(Math.pow(1.5, attempts) * 200, 5000);
    attempts++;
    retryTimer = setTimeout(attempt, wait);
  }

  retryTimer = setTimeout(attempt, delay);
}

function syncBorrowState(settings) {
  const nextActive = Boolean(settings.account && settings.enabled && settings.autoQuality);
  const becameActive = nextActive && !borrowActive;
  borrowActive = nextActive;
  if (becameActive) {
    retrySelect(800);
  } else if (!borrowActive) {
    clearTimeout(retryTimer);
  }
}

chrome.storage.local.get({ account: null, enabled: false, autoQuality: true }).then(syncBorrowState);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.account || changes.enabled || changes.autoQuality)) {
    chrome.storage.local.get({ account: null, enabled: false, autoQuality: true }).then(syncBorrowState);
  }
});

let lastUrl = location.href;
function checkUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (borrowActive) {
      retrySelect(1200);
    }
  }
}

window.addEventListener("popstate", checkUrlChange);
window.addEventListener("hashchange", () => {
  if (borrowActive) {
    retrySelect(1200);
  }
});
setInterval(checkUrlChange, 1000);

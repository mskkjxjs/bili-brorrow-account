let autoQualityEnabled = true;

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

function selectBestPlayback() {
  if (!autoQualityEnabled) {
    return false;
  }
  const qualitySelected = selectHighestQuality();
  const audioSelected = selectHighestAudio();
  return qualitySelected || audioSelected;
}

function retrySelect(maxAttempts = 15) {
  let attempts = 0;

  function attempt() {
    if (!autoQualityEnabled || attempts >= maxAttempts) {
      return;
    }

    try {
      if (selectBestPlayback()) {
        return;
      }
    } catch {}

    const delay = Math.min(Math.pow(1.5, attempts) * 200, 5000);
    attempts++;
    setTimeout(attempt, delay);
  }

  attempt();
}

let lastUrl = location.href;
function checkUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(() => retrySelect(), 1000);
  }
}

chrome.storage.local.get({ autoQuality: true }).then((settings) => {
  autoQualityEnabled = settings.autoQuality;
  if (autoQualityEnabled) {
    setTimeout(() => retrySelect(), 500);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.autoQuality) {
    autoQualityEnabled = changes.autoQuality.newValue;
    if (autoQualityEnabled) {
      retrySelect();
    }
  }
});

window.addEventListener("popstate", checkUrlChange);
window.addEventListener("hashchange", () => setTimeout(() => retrySelect(), 1000));
setInterval(checkUrlChange, 1000);

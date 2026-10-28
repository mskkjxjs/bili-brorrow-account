(() => {
  function publishState(settings) {
    const borrowActive = Boolean(settings.account && settings.enabled);
    window.dispatchEvent(new CustomEvent("bili-borrow-playback-state", {
      detail: borrowActive
    }));
    window.dispatchEvent(new CustomEvent("bili-borrow-quality-state", {
      detail: borrowActive && Boolean(settings.autoQuality)
    }));
  }

  function loadState() {
    return chrome.storage.local.get({
      account: null,
      enabled: false,
      autoQuality: true
    }).then(publishState);
  }

  loadState();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.account || changes.enabled || changes.autoQuality)) {
      loadState();
    }
  });
})();

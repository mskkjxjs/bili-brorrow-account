(() => {
  function publishState(settings) {
    window.dispatchEvent(new CustomEvent("bili-borrow-playback-state", {
      detail: Boolean(settings.account && settings.enabled)
    }));
  }

  function loadState() {
    return chrome.storage.local.get({ account: null, enabled: false }).then(publishState);
  }

  loadState();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.account || changes.enabled)) {
      loadState();
    }
  });
})();

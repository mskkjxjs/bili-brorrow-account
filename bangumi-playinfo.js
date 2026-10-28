(() => {
  let playbackEnabled = false;
  let overlayStyle = null;
  const globalRefreshes = [];

  function unlockPlaybackData(value, seen = new WeakSet()) {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return value;
    }

    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if ((key === "need_login" || key === "need_vip") && child === true) {
        value[key] = false;
      } else {
        unlockPlaybackData(child, seen);
      }
    }
    return value;
  }

  function unlockNextData(data) {
    const queries = data?.props?.pageProps?.dehydratedState?.queries;
    for (const query of queries || []) {
      unlockPlaybackData(query?.state?.data);
    }
    return data;
  }

  function interceptGlobal(name, transform = unlockPlaybackData) {
    let value = window[name];
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() {
        return value;
      },
      set(nextValue) {
        value = playbackEnabled ? transform(nextValue) : nextValue;
      }
    });
    globalRefreshes.push(() => {
      if (playbackEnabled) {
        value = transform(value);
      }
    });
  }

  interceptGlobal("__playinfo__");
  interceptGlobal("playurlSSRData");
  interceptGlobal("__PLAYURL_HYDRATE_DATA__");
  interceptGlobal("__NEXT_DATA__", unlockNextData);

  function isPlayurlRequest(input) {
    try {
      const url = new URL(input, location.href);
      return url.hostname === "api.bilibili.com" &&
        /^\/(?:x\/player\/(?:wbi\/)?playurl|pgc\/player\/web\/(?:v2\/)?playurl)$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function unlockResponseValue(value) {
    if (!playbackEnabled || typeof value !== "string") {
      return playbackEnabled ? unlockPlaybackData(value) : value;
    }

    try {
      return JSON.stringify(unlockPlaybackData(JSON.parse(value)));
    } catch {
      return value;
    }
  }

  const xhrUrls = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const responseDescriptors = Object.fromEntries(
    ["response", "responseText"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, name)
    ])
  );

  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    xhrUrls.set(this, String(url));
    return originalOpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (isPlayurlRequest(xhrUrls.get(this))) {
      for (const [name, descriptor] of Object.entries(responseDescriptors)) {
        Object.defineProperty(this, name, {
          configurable: true,
          get() {
            return unlockResponseValue(descriptor.get.call(this));
          }
        });
      }
    }
    return originalSend.apply(this, args);
  };

  const originalFetch = window.fetch;
  window.fetch = function(input, ...args) {
    const url = typeof input === "string" || input instanceof URL ? input : input?.url;
    const result = originalFetch.call(this, input, ...args);
    if (!isPlayurlRequest(url)) {
      return result;
    }

    return result.then((response) => {
      const originalText = response.text.bind(response);
      const originalJson = response.json.bind(response);
      Object.defineProperties(response, {
        text: {
          configurable: true,
          value: async () => unlockResponseValue(await originalText())
        },
        json: {
          configurable: true,
          value: async () => {
            const value = await originalJson();
            return playbackEnabled ? unlockPlaybackData(value) : value;
          }
        }
      });
      return response;
    });
  };

  function syncOverlay() {
    if (playbackEnabled && !overlayStyle) {
      overlayStyle = document.createElement("style");
      overlayStyle.textContent = 'div[class^="playerPop"] { display: none !important; }';
      (document.head || document.documentElement).appendChild(overlayStyle);
    } else if (!playbackEnabled && overlayStyle) {
      overlayStyle.remove();
      overlayStyle = null;
    }
  }

  function updatePlaybackState(enabled) {
    playbackEnabled = enabled;
    for (const refresh of globalRefreshes) {
      refresh();
    }
    syncOverlay();
  }

  window.addEventListener("bili-borrow-playback-state", (event) => {
    updatePlaybackState(event.detail === true);
  });

  function episodeIdFromUrl(url) {
    return url.pathname.match(/\/ep(\d+)/)?.[1];
  }

  let episodeId = episodeIdFromUrl(location);
  setInterval(() => {
    if (!playbackEnabled) {
      return;
    }

    const nextEpisodeId = episodeIdFromUrl(location);
    if (nextEpisodeId) {
      if (nextEpisodeId !== episodeId) {
        episodeId = nextEpisodeId;
        location.reload();
      }
      return;
    }

    const selectedEpisode = document.querySelector(
      'a[class*="activeNumber"][href*="/bangumi/play/ep"]'
    );
    const selectedEpisodeId = selectedEpisode
      ? episodeIdFromUrl(new URL(selectedEpisode.href))
      : null;
    if (selectedEpisodeId) {
      location.replace(`https://www.bilibili.com/bangumi/play/ep${selectedEpisodeId}`);
    }
  }, 250);
})();

(() => {
  let playbackEnabled = false;
  let qualityBoost = false;
  let stateKnown = false;
  let overlayStyle = null;
  let progressRestoreStarted = false;
  const globalRefreshes = [];

  function isBangumiPage() {
    return location.pathname.startsWith("/bangumi/play/");
  }

  function isPlayData(value) {
    return (
      value &&
      typeof value === "object" &&
      Array.isArray(value.dash?.video) &&
      Number.isFinite(value.quality)
    );
  }

  function optimizePlaybackData(value, seen = new WeakSet()) {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return value;
    }

    seen.add(value);
    if (isPlayData(value)) {
      const accepted = Array.isArray(value.accept_quality)
        ? value.accept_quality.filter((id) => Number.isFinite(id))
        : [];
      const ids = value.dash.video
        .map((stream) => stream?.id)
        .filter((id) => Number.isFinite(id) && (accepted.length === 0 || accepted.includes(id)));
      if (ids.length > 0) {
        value.quality = Math.max(...ids);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if ((key === "need_login" || key === "need_vip") && child === true) {
        value[key] = false;
      } else {
        optimizePlaybackData(child, seen);
      }
    }
    return value;
  }

  function optimizeNextData(data) {
    const queries = data?.props?.pageProps?.dehydratedState?.queries;
    for (const query of queries || []) {
      optimizePlaybackData(query?.state?.data);
    }
    return data;
  }

  function interceptGlobal(name, transform = optimizePlaybackData) {
    let value = window[name];
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() {
        return value;
      },
      set(nextValue) {
        value = qualityBoost ? transform(nextValue) : nextValue;
      }
    });
    globalRefreshes.push(() => {
      if (qualityBoost) {
        value = transform(value);
      }
    });
  }

  // 普通视频页的 SSR 播放数据来自大号（最高 1080P）。开启最高画质时隐藏它，
  // 让播放器改用接口取流，才能首帧即按小号权限播放。
  let playinfoValue;
  Object.defineProperty(window, "__playinfo__", {
    configurable: true,
    enumerable: true,
    get() {
      if (!isBangumiPage() && (!stateKnown || qualityBoost)) {
        return undefined;
      }
      return qualityBoost ? optimizePlaybackData(playinfoValue) : playinfoValue;
    },
    set(nextValue) {
      playinfoValue = nextValue;
    }
  });

  interceptGlobal("playurlSSRData");
  interceptGlobal("__PLAYURL_HYDRATE_DATA__");
  interceptGlobal("__NEXT_DATA__", optimizeNextData);

  function isPlayurlRequest(input) {
    try {
      const url = new URL(input, location.href);
      return url.hostname === "api.bilibili.com" &&
        /^\/(?:x\/player\/(?:wbi\/)?playurl|pgc\/player\/web\/(?:v2\/)?playurl)$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function optimizeResponseValue(value) {
    if (!qualityBoost || typeof value !== "string") {
      return qualityBoost ? optimizePlaybackData(value) : value;
    }

    try {
      return JSON.stringify(optimizePlaybackData(JSON.parse(value)));
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
            return optimizeResponseValue(descriptor.get.call(this));
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
          value: async () => optimizeResponseValue(await originalText())
        },
        json: {
          configurable: true,
          value: async () => {
            const value = await originalJson();
            return qualityBoost ? optimizePlaybackData(value) : value;
          }
        }
      });
      return response;
    });
  };

  function syncOverlay() {
    const shouldHide = playbackEnabled && isBangumiPage();
    if (shouldHide && !overlayStyle) {
      overlayStyle = document.createElement("style");
      overlayStyle.textContent = 'div[class^="playerPop"] { display: none !important; }';
      (document.head || document.documentElement).appendChild(overlayStyle);
    } else if (!shouldHide && overlayStyle) {
      overlayStyle.remove();
      overlayStyle = null;
    }
  }

  async function loadHistoryProgress() {
    const episodeId = Number(location.pathname.match(/\/ep(\d+)/)?.[1]);
    if (!episodeId) {
      return null;
    }

    const response = await fetch(
      "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
      { credentials: "include" }
    );
    const data = await response.json();
    const entry = data.data?.list?.find((item) =>
      item.history?.business === "pgc" && Number(item.history.epid) === episodeId
    );
    return entry?.progress > 0 ? entry.progress : null;
  }

  function waitForVideo() {
    return new Promise((resolve) => {
      let attempts = 0;
      function findVideo() {
        const video = document.querySelector(".bpx-player-video-wrap video, video");
        if (video || ++attempts >= 60) {
          clearInterval(timer);
          resolve(video);
        }
      }

      const timer = setInterval(findVideo, 500);
      findVideo();
    });
  }

  function restoreVideoProgress(video, progress) {
    function seek() {
      if (Math.abs(video.currentTime - progress) < 2) {
        return;
      }
      if (Number.isFinite(video.duration) && progress >= video.duration - 5) {
        return;
      }
      try {
        video.currentTime = progress;
      } catch {}
    }

    if (video.readyState >= 1) {
      seek();
    } else {
      video.addEventListener("loadedmetadata", seek, { once: true });
    }
    video.addEventListener("canplay", seek, { once: true });
  }

  async function restorePlaybackProgress() {
    if (progressRestoreStarted) {
      return;
    }
    progressRestoreStarted = true;

    try {
      const progress = await loadHistoryProgress();
      if (!progress) {
        return;
      }
      const video = await waitForVideo();
      if (video) {
        restoreVideoProgress(video, progress);
      }
    } catch {}
  }

  function updatePlaybackState(enabled) {
    playbackEnabled = enabled;
    stateKnown = true;
    syncOverlay();
    if (playbackEnabled && isBangumiPage()) {
      restorePlaybackProgress();
    }
  }

  function updateQualityState(enabled) {
    qualityBoost = enabled;
    stateKnown = true;
    for (const refresh of globalRefreshes) {
      refresh();
    }
  }

  window.addEventListener("bili-borrow-playback-state", (event) => {
    updatePlaybackState(event.detail === true);
  });

  window.addEventListener("bili-borrow-quality-state", (event) => {
    updateQualityState(event.detail === true);
  });

  function episodeIdFromUrl(url) {
    return url.pathname.match(/\/ep(\d+)/)?.[1];
  }

  let episodeId = episodeIdFromUrl(location);
  setInterval(() => {
    if (!playbackEnabled || !isBangumiPage()) {
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

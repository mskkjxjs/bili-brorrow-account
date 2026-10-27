(() => {
  function discardInitialAssignment(name) {
    let value;
    let waitingForInitialValue = true;

    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() {
        return value;
      },
      set(nextValue) {
        if (waitingForInitialValue && document.readyState === "loading") {
          waitingForInitialValue = false;
          return;
        }
        value = nextValue;
      }
    });

    return (nextValue) => {
      value = nextValue;
    };
  }

  discardInitialAssignment("__playinfo__");
  const replaceHydratedPlayurl = discardInitialAssignment("__PLAYURL_HYDRATE_DATA__");
  const episodeId = location.pathname.match(/\/ep(\d+)/)?.[1];
  if (!episodeId) {
    return;
  }

  function loadPlayurl() {
    const params = new URLSearchParams({
      ep_id: episodeId,
      qn: "80",
      fnval: "4048",
      fourk: "1"
    });
    const request = new XMLHttpRequest();
    request.open("GET", `https://api.bilibili.com/pgc/player/web/v2/playurl?${params}`, false);
    request.withCredentials = true;
    request.send();
    if (request.status < 200 || request.status >= 300) {
      return null;
    }

    const data = JSON.parse(request.responseText);
    return data.code === 0 && data.result?.video_info ? data : null;
  }

  try {
    const data = loadPlayurl();
    if (data) {
      replaceHydratedPlayurl(data);
    }
  } catch {}
})();

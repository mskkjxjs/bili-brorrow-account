const RULE_IDS = [1, 2, 3];
const ALL_RULE_IDS = [1, 2, 3, 4, 5];
const STORAGE_DEFAULTS = {
  account: null,
  enabled: false,
  autoQuality: true,
  autoRefresh: false,
  autoCheckUpdate: true,
  updateStatus: null,
  refreshStatus: ""
};
const REFRESH_URL = "https://passport.bilibili.com/x/passport-login/web/cookie/refresh";
const QR_POLL_URL_PREFIX = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const UPDATE_API_URL = "https://api.github.com/repos/mskkjxjs/bili-brorrow-account/releases/latest";
const RELEASE_PAGE = "https://github.com/mskkjxjs/bili-brorrow-account/releases/latest";
const UPDATE_ALARM = "check-update";
const UPDATE_PERIOD_MINUTES = 1440;
let refreshedCookies = null;
let qrCookies = null;
let refreshPromise = null;

function normalizeAccount(input) {
  const value = input.trim();
  if (!value || value.length > 4096 || !/^[\x21\x23-\x2B\x2D-\x3A\x3C\x3E-\x5B\x5D-\x7E]+$/.test(value)) {
    throw new Error("请只填写有效的 SESSDATA 值，不要包含名称、等号或分号。");
  }

  return { cookie: `SESSDATA=${value}` };
}

function normalizeRefreshValue(input, label) {
  const value = input.trim();
  if (!value || value.length > 512 || !/^[0-9A-Za-z_.~+/=-]+$/.test(value)) {
    throw new Error(`请填写有效的 ${label}。`);
  }
  return value;
}

async function getStoredState() {
  const settings = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const configured = Boolean(settings.account);
  return {
    configured,
    enabled: configured && settings.enabled,
    autoQuality: settings.autoQuality,
    autoRefresh: settings.autoRefresh,
    autoCheckUpdate: settings.autoCheckUpdate,
    updateStatus: settings.updateStatus,
    refreshStatus: settings.refreshStatus
  };
}

function buildRule(id, cookie, condition) {
  return {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Cookie",
          operation: "set",
          value: cookie
        }
      ]
    },
    condition
  };
}

function buildRules(account, playbackActive, refreshActive) {
  const rules = [];
  if (playbackActive) {
    rules.push(
      buildRule(1, account.cookie, {
        regexFilter: "^https://api\\.bilibili\\.com/(?:x/player/(?:wbi/)?playurl|pgc/player/web/(?:v2/)?playurl)(?:\\?|$)",
        initiatorDomains: ["www.bilibili.com"]
      }),
      buildRule(2, account.cookie, {
        regexFilter: "^https://api\\.bilibili\\.com/x/player/(?:wbi/)?v2(?:\\?|$)",
        initiatorDomains: ["www.bilibili.com"]
      }),
      buildRule(3, account.cookie, {
        regexFilter: "^https://www\\.bilibili\\.com/bangumi/play/ep\\d+(?:[?#]|$)",
        resourceTypes: ["main_frame"]
      })
    );
  }
  if (refreshActive) {
    rules.push(buildRule(5, `${account.cookie}; bili_jct=${account.csrf}`, {
      regexFilter: "^https://(?:passport\\.bilibili\\.com/x/passport-login/web/(?:cookie/(?:info|refresh)|confirm/refresh)|www\\.bilibili\\.com/correspond/1/)",
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ["xmlhttprequest"]
    }));
  }
  return rules;
}

async function syncRule() {
  const settings = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const account = settings.account;
  const active = Boolean(account && settings.enabled);
  const refreshActive = Boolean(settings.autoRefresh && account?.csrf && account?.refreshToken);
  const addRules = buildRules(account, active, refreshActive);

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ALL_RULE_IDS,
      addRules
    });
  } catch {
    throw new Error("浏览器无法应用请求规则，请使用 Chrome 或 Edge 128 及更高版本。");
  }

  await syncBadge();

  if (refreshActive) {
    chrome.alarms.create("refresh-sessdata", { periodInMinutes: 1440 });
  } else {
    await chrome.alarms.clear("refresh-sessdata");
  }

  return {
    configured: Boolean(account),
    enabled: active,
    active,
    autoQuality: settings.autoQuality,
    autoRefresh: settings.autoRefresh,
    autoCheckUpdate: settings.autoCheckUpdate,
    updateStatus: settings.updateStatus,
    update: settings.updateStatus
      ? { ...settings.updateStatus, updateAvailable: hasUpdate(settings.updateStatus) }
      : null,
    refreshStatus: settings.refreshStatus
  };
}

async function getState() {
  const [state, rules] = await Promise.all([
    getStoredState(),
    chrome.declarativeNetRequest.getDynamicRules()
  ]);
  return {
    ...state,
    update: state.updateStatus
      ? { ...state.updateStatus, updateAvailable: hasUpdate(state.updateStatus) }
      : null,
    active: state.enabled && RULE_IDS.every((id) => rules.some((rule) => rule.id === id))
  };
}

function parseVersion(value) {
  return String(value || "").replace(/^v/i, "").split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function hasUpdate(status) {
  if (!status?.latestVersion) {
    return false;
  }
  const latest = parseVersion(status.latestVersion);
  const current = parseVersion(chrome.runtime.getManifest().version);
  for (let i = 0; i < Math.max(latest.length, current.length); i++) {
    if ((latest[i] || 0) !== (current[i] || 0)) {
      return (latest[i] || 0) > (current[i] || 0);
    }
  }
  return false;
}

async function syncBadge() {
  const settings = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const active = Boolean(settings.account && settings.enabled);
  const update = hasUpdate(settings.updateStatus);

  await chrome.action.setBadgeBackgroundColor({ color: update ? "#ff7a00" : "#00a1d6" });
  await chrome.action.setBadgeText({ text: update ? "新" : active ? "小" : "" });
  await chrome.action.setTitle({
    title: update
      ? `借用B站账号：发现新版本 ${settings.updateStatus.latestVersion}`
      : active
        ? "借用B站账号：小号初始化和取流已启用，观看历史仍使用大号"
        : settings.account
          ? "借用B站账号：已停用"
          : "借用B站账号：请先填写小号 SESSDATA"
  });
}

async function checkForUpdate() {
  const currentVersion = chrome.runtime.getManifest().version;
  let status;
  try {
    const response = await fetch(UPDATE_API_URL, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) {
      throw new Error(`更新接口返回 HTTP ${response.status}`);
    }
    const release = await response.json();
    const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
    if (!latestVersion) {
      throw new Error("更新接口未返回版本号。");
    }
    status = {
      checkedAt: Date.now(),
      currentVersion,
      latestVersion,
      url: release.html_url || RELEASE_PAGE,
      error: ""
    };
  } catch (error) {
    status = {
      checkedAt: Date.now(),
      currentVersion,
      latestVersion: "",
      url: RELEASE_PAGE,
      error: error.message
    };
  }

  await chrome.storage.local.set({ updateStatus: status });
  await syncBadge();
  return getState();
}

async function setAutoCheckUpdate(enabled) {
  await chrome.storage.local.set({ autoCheckUpdate: enabled });
  if (enabled) {
    chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MINUTES });
    return checkForUpdate();
  }

  await chrome.alarms.clear(UPDATE_ALARM);
  return getState();
}

async function saveSettings(message) {
  const current = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const account = message.sessdata
    ? normalizeAccount(message.sessdata)
    : current.account
      ? { ...current.account }
      : null;
  if (account && message.csrf) {
    account.csrf = normalizeRefreshValue(message.csrf, "bili_jct");
  }
  if (account && message.refreshToken) {
    account.refreshToken = normalizeRefreshValue(message.refreshToken, "ac_time_value");
  }

  const enabled = Boolean(message.enabled);
  const autoQuality = Boolean(message.autoQuality);
  const autoRefresh = Boolean(message.autoRefresh);
  if (enabled && !account) {
    throw new Error("请先填写小号 SESSDATA，再启用小号初始化并取流。");
  }
  if (autoRefresh && (!account?.csrf || !account?.refreshToken)) {
    throw new Error("自动续期需要同时填写 SESSDATA、bili_jct 和 ac_time_value。");
  }

  await chrome.storage.local.set({ account, enabled, autoQuality, autoRefresh });
  const state = await syncRule();
  if (autoRefresh) {
    checkAndRefresh().catch(() => {});
  }
  return state;
}

async function clearSettings() {
  await chrome.storage.local.set({
    account: null,
    enabled: false,
    autoRefresh: false,
    refreshStatus: ""
  });
  return syncRule();
}

async function updateRefreshStatus(text) {
  await chrome.storage.local.set({
    refreshStatus: `${text}（${new Date().toLocaleString("zh-CN")}）`
  });
}

async function refreshFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "omit",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`续期接口返回 HTTP ${response.status}`);
  }
  return response;
}

async function refreshJson(url, options) {
  const response = await refreshFetch(url, options);
  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(data.message || `续期接口错误 ${data.code}`);
  }
  return data;
}

async function getCorrespondPath(timestamp) {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "RSA",
      n: "y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE",
      e: "AQAB"
    },
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    new TextEncoder().encode(`refresh_${timestamp}`)
  ));
  return Array.from(encrypted, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formBody(values) {
  return new URLSearchParams(values);
}

async function performRefreshCheck() {
  const settings = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const account = settings.account;
  if (!settings.autoRefresh) {
    return;
  }
  if (!account?.csrf || !account?.refreshToken) {
    throw new Error("自动续期凭证不完整，请重新填写并保存。");
  }

  try {
    const info = await refreshJson(
      "https://passport.bilibili.com/x/passport-login/web/cookie/info"
    );
    if (!info.data.refresh) {
      await updateRefreshStatus("SESSDATA 检查正常，无需续期");
      return;
    }

    const correspondPath = await getCorrespondPath(info.data.timestamp);
    const correspondResponse = await refreshFetch(
      `https://www.bilibili.com/correspond/1/${correspondPath}`
    );
    const correspondHtml = await correspondResponse.text();
    const refreshCsrf = correspondHtml.match(/<div id="1-name">([^<]+)<\/div>/)?.[1];
    if (!refreshCsrf) {
      throw new Error("未获取到 refresh_csrf");
    }

    refreshedCookies = null;
    const refreshed = await refreshJson(REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        csrf: account.csrf,
        refresh_csrf: refreshCsrf,
        source: "main_web",
        refresh_token: account.refreshToken
      })
    });
    const sessdata = refreshedCookies?.SESSDATA;
    const csrf = refreshedCookies?.bili_jct;
    const refreshToken = refreshed.data.refresh_token;
    if (!sessdata || !csrf || !refreshToken) {
      throw new Error("刷新响应缺少新 Cookie 或 refresh_token");
    }

    const newAccount = {
      cookie: `SESSDATA=${sessdata}`,
      csrf,
      refreshToken
    };
    await chrome.storage.local.set({ account: newAccount });
    await syncRule();

    await refreshJson("https://passport.bilibili.com/x/passport-login/web/confirm/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ csrf, refresh_token: account.refreshToken })
    });
    await updateRefreshStatus("SESSDATA 已自动续期");
  } catch (error) {
    await updateRefreshStatus(`自动续期失败：${error.message}`);
    throw error;
  } finally {
    refreshedCookies = null;
  }
}

function checkAndRefresh() {
  if (!refreshPromise) {
    refreshPromise = performRefreshCheck().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.initiator !== `chrome-extension://${chrome.runtime.id}`) {
      return;
    }
    const cookies = {};
    for (const header of details.responseHeaders || []) {
      if (header.name.toLowerCase() !== "set-cookie") {
        continue;
      }
      const match = header.value?.match(/^(SESSDATA|bili_jct)=([^;]*)/);
      if (match) {
        cookies[match[1]] = match[2];
      }
    }
    if (!cookies.SESSDATA && !cookies.bili_jct) {
      return;
    }
    if (details.url.startsWith(QR_POLL_URL_PREFIX)) {
      qrCookies = cookies;
    } else if (details.url.startsWith(REFRESH_URL)) {
      refreshedCookies = cookies;
    }
  },
  { urls: ["https://passport.bilibili.com/*"], types: ["xmlhttprequest"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh-sessdata") {
    checkAndRefresh().catch(() => {});
  } else if (alarm.name === UPDATE_ALARM) {
    chrome.storage.local.get({ autoCheckUpdate: true }).then((settings) => {
      if (settings.autoCheckUpdate) {
        checkForUpdate().catch(() => {});
      }
    });
  }
});

async function handleMessage(message) {
  switch (message.type) {
    case "GET_STATE":
      return getState();
    case "SAVE_SETTINGS":
      return saveSettings(message);
    case "CLEAR_SETTINGS":
      return clearSettings();
    case "CHECK_UPDATE":
      return checkForUpdate();
    case "SET_AUTO_CHECK_UPDATE":
      return setAutoCheckUpdate(Boolean(message.enabled));
    case "TAKE_QR_COOKIES": {
      const cookies = qrCookies || {};
      qrCookies = null;
      return { cookies };
    }
    case "RESET_QR_COOKIES":
      qrCookies = null;
      return { cookies: {} };
    default:
      throw new Error("未知操作。");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(
    (state) => sendResponse({ ok: true, state }),
    (error) => sendResponse({ ok: false, error: error.message })
  );
  return true;
});

function refreshRule() {
  return syncRule().catch(async () => {
    await chrome.action.setBadgeText({ text: "!" });
  });
}

async function initialize() {
  await refreshRule();
  await checkAndRefresh().catch(() => {});
  const { autoCheckUpdate } = await chrome.storage.local.get({ autoCheckUpdate: true });
  if (autoCheckUpdate) {
    chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MINUTES });
    await checkForUpdate().catch(() => {});
  } else {
    await syncBadge();
  }
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

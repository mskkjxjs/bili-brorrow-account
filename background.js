const RULE_IDS = [1, 2];
const ALL_RULE_IDS = [1, 2, 3, 4];
const STORAGE_DEFAULTS = { account: null, enabled: false };

function normalizeAccount(input) {
  const value = input.trim();
  if (!value || value.length > 4096 || !/^[\x21\x23-\x2B\x2D-\x3A\x3C\x3E-\x5B\x5D-\x7E]+$/.test(value)) {
    throw new Error("请只填写有效的 SESSDATA 值，不要包含名称、等号或分号。");
  }

  return { cookie: `SESSDATA=${value}` };
}

async function getStoredState() {
  const settings = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const configured = Boolean(settings.account);
  return {
    configured,
    enabled: configured && settings.enabled
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

function buildRules(cookie) {
  return [
    buildRule(1, cookie, {
      regexFilter: "^https://api\\.bilibili\\.com/(?:x/player/(?:wbi/)?playurl|pgc/player/web/(?:v2/)?playurl)(?:\\?|$)",
      initiatorDomains: ["www.bilibili.com"]
    }),
    buildRule(2, cookie, {
      regexFilter: "^https://api\\.bilibili\\.com/x/player/(?:wbi/)?v2(?:\\?|$)",
      initiatorDomains: ["www.bilibili.com"]
    })
  ];
}

async function syncRule() {
  const settings = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const account = settings.account;
  const active = Boolean(account && settings.enabled);
  const addRules = active ? buildRules(account.cookie) : [];

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ALL_RULE_IDS,
      addRules
    });
  } catch {
    throw new Error("浏览器无法应用请求规则，请使用 Chrome 或 Edge 128 及更高版本。");
  }

  await chrome.action.setBadgeBackgroundColor({ color: "#00a1d6" });
  await chrome.action.setBadgeText({ text: active ? "小" : "" });
  await chrome.action.setTitle({
    title: active
      ? "借用B站账号：小号初始化和取流已启用，观看历史仍使用大号"
      : account
        ? "借用B站账号：已停用"
        : "借用B站账号：请先填写小号 SESSDATA"
  });

  return {
    configured: Boolean(account),
    enabled: active,
    active
  };
}

async function getState() {
  const [state, rules] = await Promise.all([
    getStoredState(),
    chrome.declarativeNetRequest.getDynamicRules()
  ]);
  return {
    ...state,
    active: state.enabled && RULE_IDS.every((id) => rules.some((rule) => rule.id === id))
  };
}

async function saveSettings(message) {
  const current = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const account = message.sessdata
    ? normalizeAccount(message.sessdata)
    : current.account;
  const enabled = Boolean(message.enabled);
  if (enabled && !account) {
    throw new Error("请先填写小号 SESSDATA，再启用小号初始化并取流。");
  }

  await chrome.storage.local.set({ account, enabled });
  return syncRule();
}

async function clearSettings() {
  await chrome.storage.local.set({ account: null, enabled: false });
  return syncRule();
}

async function handleMessage(message) {
  switch (message.type) {
    case "GET_STATE":
      return getState();
    case "SAVE_SETTINGS":
      return saveSettings(message);
    case "CLEAR_SETTINGS":
      return clearSettings();
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
  syncRule().catch(async () => {
    await chrome.action.setBadgeText({ text: "!" });
  });
}

chrome.runtime.onInstalled.addListener(refreshRule);
chrome.runtime.onStartup.addListener(refreshRule);

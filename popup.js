const form = document.querySelector("#settings-form");
const sessdataInput = document.querySelector("#sessdata");
const csrfInput = document.querySelector("#bili-jct");
const refreshTokenInput = document.querySelector("#refresh-token");
const enabledInput = document.querySelector("#enabled");
const autoQualityInput = document.querySelector("#auto-quality");
const autoRefreshInput = document.querySelector("#auto-refresh");
const saveButton = document.querySelector("#save-button");
const clearButton = document.querySelector("#clear-button");
const stateDot = document.querySelector("#state-dot");
const stateText = document.querySelector("#state-text");
const refreshStatusText = document.querySelector("#refresh-status");
const messageText = document.querySelector("#message");
const qrButton = document.querySelector("#qr-button");
const qrPanel = document.querySelector("#qr-panel");
const qrCodeElement = document.querySelector("#qr-code");
const qrStatusText = document.querySelector("#qr-status");
const currentVersionText = document.querySelector("#current-version");
const checkUpdateButton = document.querySelector("#check-update-button");
const updateStatusText = document.querySelector("#update-status");
const updateLink = document.querySelector("#update-link");
const autoCheckUpdateInput = document.querySelector("#auto-check-update");

const QR_GENERATE_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const QR_POLL_INTERVAL_MS = 2000;
const RELEASE_PAGE = "https://github.com/mskkjxjs/bili-brorrow-account/releases/latest";
const qrMode = new URLSearchParams(location.search).get("qr") === "1";

let qrJobId = 0;
let qrPollTimer = null;

function render(state) {
  enabledInput.checked = state.enabled;
  autoQualityInput.checked = state.autoQuality;
  autoRefreshInput.checked = state.autoRefresh;
  autoCheckUpdateInput.checked = state.autoCheckUpdate;
  refreshStatusText.textContent = state.refreshStatus || "";
  sessdataInput.required = false;
  stateDot.classList.toggle("active", state.active);
  renderUpdate(state.update || null);

  if (state.active) {
    stateText.textContent = "已启用：大号浏览和记录，小号初始化并取流";
  } else if (state.configured) {
    stateText.textContent = "已配置小号，但当前未启用";
  } else {
    stateText.textContent = "尚未配置小号，请扫码登录或填写 SESSDATA";
  }
}

function renderUpdate(update) {
  updateStatusText.classList.remove("error");
  updateLink.href = RELEASE_PAGE;
  updateLink.textContent = "查看 GitHub 发布页";
  if (!update) {
    updateStatusText.textContent = "尚未检查更新";
    return;
  }

  const time = update.checkedAt ? new Date(update.checkedAt).toLocaleString("zh-CN") : "";
  if (update.error) {
    updateStatusText.textContent = `检查失败：${update.error}${time ? `（${time}）` : ""}`;
    updateStatusText.classList.add("error");
    return;
  }

  if (update.updateAvailable) {
    updateStatusText.textContent = `发现新版本 ${update.latestVersion}（当前 ${update.currentVersion}）`;
    updateLink.href = update.url || RELEASE_PAGE;
    updateLink.textContent = "前往 GitHub 下载新版本";
    return;
  }

  updateStatusText.textContent =
    `已是最新版本（${update.currentVersion}）${time ? ` · ${time}` : ""}`;
}

function showMessage(text, isError = false) {
  messageText.textContent = text;
  messageText.classList.toggle("error", isError);
}

function showQrStatus(text, isError = false) {
  qrStatusText.textContent = text;
  qrStatusText.classList.toggle("error", isError);
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) {
    throw new Error(response?.error || "扩展后台未响应，请重新加载扩展。");
  }
  return response.state;
}

async function loadState() {
  try {
    const [state, settings] = await Promise.all([
      send("GET_STATE"),
      chrome.storage.local.get({ account: null })
    ]);
    render(state);
    if (settings.account) {
      sessdataInput.value = (settings.account.cookie.match(/(?:^|;\s*)SESSDATA=([^;]*)/)?.[1] || "")
        .replace(/^SESSDATA=/, "");
      csrfInput.value = settings.account.csrf || "";
      refreshTokenInput.value = settings.account.refreshToken || "";
    }
  } catch (error) {
    showMessage(error.message, true);
  }
}

function stopQrPoll() {
  qrJobId++;
  clearTimeout(qrPollTimer);
  qrPollTimer = null;
}

function rawQueryParam(url, name) {
  const query = String(url || "").split("?")[1]?.split("#")[0] || "";
  for (const pair of query.split("&")) {
    const index = pair.indexOf("=");
    if (index > 0 && pair.slice(0, index) === name) {
      return pair.slice(index + 1);
    }
  }
  return "";
}

function renderQr(text) {
  qrCodeElement.textContent = "";
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  qrCodeElement.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
}

async function startQrLogin() {
  stopQrPoll();
  const job = qrJobId;
  qrPanel.hidden = false;
  qrCodeElement.textContent = "";
  showQrStatus("正在申请二维码…");
  qrButton.disabled = true;
  send("RESET_QR_COOKIES").catch(() => {});

  try {
    const response = await fetch(QR_GENERATE_URL, { credentials: "omit", cache: "no-store" });
    const json = await response.json();
    if (json.code !== 0) {
      throw new Error(json.message || `申请二维码失败（${json.code}）`);
    }
    const url = json.data?.url?.trim();
    const key = json.data?.qrcode_key?.trim();
    if (!url || !key) {
      throw new Error("二维码数据不完整。");
    }

    renderQr(url);
    showQrStatus("请使用哔哩哔哩 App 扫码登录小号");
    qrButton.disabled = false;
    scheduleQrPoll(job, key);
  } catch (error) {
    showQrStatus(error.message, true);
    qrButton.disabled = false;
  }
}

function scheduleQrPoll(job, key) {
  if (job !== qrJobId) {
    return;
  }
  qrPollTimer = setTimeout(() => pollQr(job, key), QR_POLL_INTERVAL_MS);
}

async function pollQr(job, key) {
  if (job !== qrJobId) {
    return;
  }

  try {
    const response = await fetch(
      `${QR_POLL_URL}?qrcode_key=${encodeURIComponent(key)}`,
      { credentials: "omit", cache: "no-store" }
    );
    const json = await response.json();
    const data = json.data || {};
    const state = typeof data.code === "number" ? data.code : json.code;
    if (job !== qrJobId) {
      return;
    }

    if (state === 86101) {
      showQrStatus("等待扫码…");
    } else if (state === 86090) {
      showQrStatus("已扫码，请在手机上确认");
    } else if (state === 86038) {
      showQrStatus("二维码已失效，请点击按钮重新获取。", true);
      return;
    } else if (state === 0) {
      showQrStatus("登录成功，正在填入凭证…");
      await finishQrLogin(data);
      return;
    } else if (json.code !== 0) {
      showQrStatus(json.message || `轮询失败（${json.code}）`, true);
    }
  } catch (error) {
    if (job === qrJobId) {
      showQrStatus(`轮询失败：${error.message}`, true);
    }
  }

  scheduleQrPoll(job, key);
}

async function finishQrLogin(data) {
  let sessdata = "";
  let biliJct = "";
  try {
    const captured = await send("TAKE_QR_COOKIES");
    sessdata = captured?.cookies?.SESSDATA || "";
    biliJct = captured?.cookies?.bili_jct || "";
  } catch {}
  sessdata = sessdata || rawQueryParam(data.url, "SESSDATA");
  biliJct = biliJct || rawQueryParam(data.url, "bili_jct");

  if (!sessdata) {
    showQrStatus("登录成功，但未获取到 SESSDATA，请重试或手动填写。", true);
    return;
  }

  sessdataInput.value = sessdata;
  csrfInput.value = biliJct;
  refreshTokenInput.value = data.refresh_token || "";
  stopQrPoll();
  showQrStatus("扫码成功，三项 Cookie 已自动填入，请点击保存设置。");
  saveButton.focus();
}

qrButton.addEventListener("click", () => {
  if (qrMode) {
    startQrLogin();
    return;
  }

  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?qr=1"),
    type: "popup",
    width: 400,
    height: 760
  }).then(() => window.close());
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  showMessage("正在保存…");

  try {
    const sessdata = sessdataInput.value.trim();
    const state = await send("SAVE_SETTINGS", {
      sessdata,
      csrf: csrfInput.value.trim(),
      refreshToken: refreshTokenInput.value.trim(),
      enabled: enabledInput.checked,
      autoQuality: autoQualityInput.checked,
      autoRefresh: autoRefreshInput.checked
    });
    render(state);
    showMessage("设置已保存，请刷新视频页面。");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

clearButton.addEventListener("click", async () => {
  if (!window.confirm("确定清除已保存的小号凭证并停用取流和自动续期吗？")) {
    return;
  }

  clearButton.disabled = true;
  try {
    render(await send("CLEAR_SETTINGS"));
    sessdataInput.value = "";
    csrfInput.value = "";
    refreshTokenInput.value = "";
    stopQrPoll();
    qrPanel.hidden = true;
    showMessage("已清除小号凭证，取流和自动续期已停用。");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    clearButton.disabled = false;
  }
});

window.addEventListener("unload", stopQrPoll);

currentVersionText.textContent = `v${chrome.runtime.getManifest().version}`;

checkUpdateButton.addEventListener("click", async () => {
  checkUpdateButton.disabled = true;
  updateStatusText.classList.remove("error");
  updateStatusText.textContent = "正在检查更新…";
  try {
    renderUpdate((await send("CHECK_UPDATE")).update || null);
  } catch (error) {
    updateStatusText.textContent = `检查失败：${error.message}`;
    updateStatusText.classList.add("error");
  } finally {
    checkUpdateButton.disabled = false;
  }
});

autoCheckUpdateInput.addEventListener("change", async () => {
  autoCheckUpdateInput.disabled = true;
  try {
    render(await send("SET_AUTO_CHECK_UPDATE", { enabled: autoCheckUpdateInput.checked }));
  } catch (error) {
    autoCheckUpdateInput.checked = !autoCheckUpdateInput.checked;
    showMessage(error.message, true);
  } finally {
    autoCheckUpdateInput.disabled = false;
  }
});

updateLink.addEventListener("click", (event) => {
  event.preventDefault();
  const url = updateLink.href;
  if (url) {
    chrome.tabs.create({ url });
  }
});

if (qrMode) {
  qrButton.textContent = "重新获取二维码";
}

loadState().then(() => {
  if (qrMode) {
    startQrLogin();
  }
});

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

function render(state) {
  enabledInput.checked = state.enabled;
  autoQualityInput.checked = state.autoQuality;
  autoRefreshInput.checked = state.autoRefresh;
  refreshStatusText.textContent = state.refreshStatus || "";
  sessdataInput.required = false;
  stateDot.classList.toggle("active", state.active);

  if (state.active) {
    stateText.textContent = "已启用：大号浏览和记录，小号初始化并取流";
  } else if (state.configured) {
    stateText.textContent = "已配置小号，但当前未启用";
  } else {
    stateText.textContent = "尚未配置小号，请填写 SESSDATA";
  }
}

function showMessage(text, isError = false) {
  messageText.textContent = text;
  messageText.classList.toggle("error", isError);
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
    showMessage("已清除小号凭证，取流和自动续期已停用。");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    clearButton.disabled = false;
  }
});

loadState();

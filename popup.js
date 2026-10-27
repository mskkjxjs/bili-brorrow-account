const form = document.querySelector("#settings-form");
const sessdataInput = document.querySelector("#sessdata");
const midInput = document.querySelector("#dede-user-id");
const csrfInput = document.querySelector("#bili-jct");
const cookieInputs = [sessdataInput, midInput, csrfInput];
const enabledInput = document.querySelector("#enabled");
const saveButton = document.querySelector("#save-button");
const clearButton = document.querySelector("#clear-button");
const stateDot = document.querySelector("#state-dot");
const stateText = document.querySelector("#state-text");
const messageText = document.querySelector("#message");

function render(state) {
  enabledInput.checked = state.enabled;
  for (const input of cookieInputs) {
    input.required = !state.configured;
  }
  stateDot.classList.toggle("active", state.active);

  if (state.active) {
    stateText.textContent = "已启用：大号浏览和记录，小号初始化并取流";
  } else if (state.configured) {
    stateText.textContent = "已配置小号，但当前未启用";
  } else {
    stateText.textContent = "尚未配置小号，请填写以下三项";
  }
}

function clearCookieInputs() {
  for (const input of cookieInputs) {
    input.value = "";
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
      sessdataInput.value = settings.account.cookie.match(/(?:^|;\s*)SESSDATA=([^;]*)/)?.[1] || "";
      midInput.value = settings.account.mid;
      csrfInput.value = settings.account.csrf;
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
    const [sessdata, mid, csrf] = cookieInputs.map((input) => input.value.trim());
    const cookie = sessdata || mid || csrf
      ? `SESSDATA=${sessdata}; DedeUserID=${mid}; bili_jct=${csrf}`
      : "";
    const state = await send("SAVE_SETTINGS", {
      cookie,
      enabled: enabledInput.checked
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
  if (!window.confirm("确定清除已保存的小号 Cookie 并停用扩展吗？")) {
    return;
  }

  clearButton.disabled = true;
  try {
    render(await send("CLEAR_SETTINGS"));
    clearCookieInputs();
    showMessage("已清除小号 Cookie，扩展已停用。");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    clearButton.disabled = false;
  }
});

loadState();

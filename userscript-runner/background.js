// パターン（例: https://example.com/*）をURLと照合するワイルドカード判定
function matchPattern(pattern, url) {
  pattern = String(pattern);
  if (!pattern.includes("://")) pattern = "*://" + pattern;
  const starCount = (pattern.match(/\*/g) || []).length;
  if (starCount === 0) pattern = pattern.replace(/\/$/, "") + "/*";
  const parts = pattern.split("*");
  let pos = 0;
  if (parts[0] !== "") {
    if (!url.startsWith(parts[0])) return false;
    pos = parts[0].length;
  }
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] === "") continue;
    const idx = url.indexOf(parts[i], pos);
    if (idx === -1) return false;
    pos = idx + parts[i].length;
  }
  const last = parts[parts.length - 1];
  if (last !== "" && !url.slice(pos - last.length).endsWith(last)) return false;
  return true;
}

// コードを注入する。userScripts API が使えるならそれを使い、
// 使えなければ chrome.scripting（script要素挿入）にフォールバックする
async function injectCode(tabId, code) {
  if (chrome.userScripts?.execute) {
    try {
      await chrome.userScripts.execute({
        target: { tabId },
        js: [{ code }],
        world: "MAIN",
        injectImmediately: true,
      });
      return;
    } catch (e) {
      console.warn("userScripts failed, falling back:", e);
    }
  }
  // フォールバック: ISOLATED world で関数を受け取り、ページに script 要素として挿入
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (src) => {
      const el = document.createElement("script");
      el.textContent = src;
      (document.head || document.documentElement).append(el);
      el.remove();
    },
    args: [code],
  });
}

async function injectAll(tabId, url) {
  const { scripts = [] } = await chrome.storage.local.get("scripts");
  for (const s of scripts) {
    const matches = Array.isArray(s.matches) ? s.matches : [];
    const ok = matches.length === 0 || matches.some((p) => matchPattern(p, url));
    if (!ok) continue;
    try {
      await injectCode(tabId, s.code);
    } catch (e) {
      console.warn("inject failed:", s.name, e);
    }
  }
}

// userScripts API は developer mode が有効である必要がある
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.userScripts.setWorldConfigurations?.([
      { world: "MAIN", messaging: false },
    ]);
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && tab.url.startsWith("http")) {
    injectAll(tabId, tab.url);
  }
});

// ポップアップからの手動実行リクエストを受け付ける
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "inject" && msg.tabId) {
    injectCode(msg.tabId, msg.code)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// userscriptの ==UserScript== ヘッダから @match / @include を抽出
function parseHeader(code) {
  const matches = [];
  const m = code.match(/==UserScript==([\s\S]*?)==\/UserScript==/);
  if (m) {
    for (const line of m[1].split("\n")) {
      const mm = line.match(/@(match|include)\s+(.+)/);
      if (mm) matches.push(mm[2].trim());
    }
  }
  return matches;
}

// ヘッダの @match を Manifest V3 の match pattern に近い形へ変換
function toPattern(p) {
  p = p.trim();
  if (p.includes("*")) return p;
  try {
    const u = new URL(p);
    return u.origin + u.pathname.replace(/\/$/, "") + "/*";
  } catch {
    return null;
  }
}

function genId() {
  return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

async function loadScripts() {
  const data = await chrome.storage.local.get("scripts");
  return Array.isArray(data.scripts) ? data.scripts : [];
}

function renderList(scripts) {
  const ul = document.getElementById("list");
  ul.innerHTML = "";
  for (const s of scripts) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = `${s.name} (${(s.matches || []).join(", ") || "全ページ"})`;
    const run1 = document.createElement("button");
    run1.textContent = "実行";
    run1.onclick = () => injectIntoActiveTab(s);
    const del = document.createElement("button");
    del.textContent = "削除";
    del.onclick = async () => {
      let all = await loadScripts();
      all = all.filter((x) => x.id !== s.id);
      await chrome.storage.local.set({ scripts: all });
      renderList(all);
    };
    li.append(span, run1, del);
    ul.append(li);
  }
}

function status(msg, isError = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.style.color = isError ? "red" : "green";
  setTimeout(() => (el.textContent = ""), 2500);
}

async function injectIntoActiveTab(script) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return status("タブが見つかりません", true);
  try {
    // background経由で chrome.userScripts API により注入（CSPの影響を受けない）
    const res = await chrome.runtime.sendMessage({
      type: "inject",
      tabId: tab.id,
      code: script.code,
    });
    if (res?.ok) {
      status("実行しました");
    } else {
      status("失敗: " + (res?.error || "不明なエラー"), true);
    }
  } catch (e) {
    status("失敗: " + e.message, true);
  }
}

// ---- ファイル選択: .user.js 等を読み込んでテキスト欄へ ----
document.getElementById("file").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const code = String(reader.result || "");
    document.getElementById("code").value = code;
    // ファイル名から拡張子を除いてスクリプト名を自動入力（空欄時のみ）
    const nameInput = document.querySelector("input[name=name]");
    if (!nameInput.value.trim()) {
      nameInput.value = file.name.replace(/\.(user\.)?js$/i, "");
    }
    // ヘッダの @match をURLマッチ欄へ自動反映（空欄時のみ）
    const matchInput = document.querySelector("input[name=match]");
    if (!matchInput.value.trim()) {
      const patterns = parseHeader(code).map(toPattern).filter(Boolean);
      if (patterns.length) matchInput.value = patterns.join(" ");
    }
    status("ファイルを読み込みました");
  };
  reader.onerror = () => status("ファイル読み込み失敗", true);
  reader.readAsText(file);
});

// ---- 保存 ----
document.getElementById("save").onclick = async () => {
  try {
    const code = document.getElementById("code").value.trim();
    if (!code) return status("コードが空です", true);
    const name =
      document.querySelector("input[name=name]").value.trim() ||
      "script-" + new Date().toISOString().slice(0, 19);

    const manual = document.querySelector("input[name=match]").value.trim();
    const headerPatterns = parseHeader(code).map(toPattern).filter(Boolean);
    // 手動入力を優先、空欄ならヘッダの @match を使用
    const patterns = manual
      ? manual.split(/\s+/).filter(Boolean)
      : headerPatterns;

    const scripts = await loadScripts();
    scripts.push({ id: genId(), name, matches: patterns, code });
    await chrome.storage.local.set({ scripts });

    // 保存結果を確認してから表示
    const check = await chrome.storage.local.get("scripts");
    if (check.scripts?.length === scripts.length) {
      renderList(check.scripts);
      status("保存しました");
    } else {
      status("保存検証に失敗", true);
    }
  } catch (e) {
    status("保存エラー: " + e.message, true);
    console.error(e);
  }
};

// ---- 現在のタブでテキスト欄のコードを実行 ----
document.getElementById("run").onclick = async () => {
  const code = document.getElementById("code").value.trim();
  if (!code) return status("コードが空です", true);
  await injectIntoActiveTab({ code });
};

loadScripts().then(renderList).catch((e) => console.error(e));

// =====================================================================
// bayesian-means.js — Bayesian Comparison of Means（計算は Cloud Run の FastAPI。グラフはPNG画像で返る）
//
// 入力欄・確認表・サンプル/Clear・状態メッセージ・実行の流れは tool-common.js（ToolCommon）を使う。
// このファイルに残すのは、このページだけの部分:
//   サンプルデータ / Tune・Draws のステッパー / API呼び出し / 結果（表と画像）の描画
// 読み込み順: page-layout.js → tool-common.js → 本ファイル（すべて defer）
// =====================================================================
const GROUPS = ["A", "B", "C", "D", "E"];
const SAMPLE_DATA = [
  "14.63, 20.18, 19.85, 20.86, 20.01, 16.96, 17.66, 18.46, 16.19, 15.76, 14.84, 20.56, 15.09, 17.18",
  "14.34, 13.09, 14.62, 14.31, 19.25, 13.03, 13.56, 13.07, 17.93, 15.09, 14.56, 15.51, 15.06, 17.36",
  "20.43, 24.43, 24.2, 17.74, 20.75, 18.87, 18.13, 17.01, 19.4, 17.37, 17.67, 23.76, 18.99, 23.72",
  "6.75, 17.33, 18.26, 20.43, 17.38, 17.34, 20.08, 16.26, 16.19, 18.88, 16.96, 20.56, 15.53, 16.75",
  "14.54, 15.4, 12.52, 18.74, 12.64, 16.48, 13.61, 16.12, 13.93, 17.89, 12.44, 12.51, 17.24, 14.29"
];
const PLACEHOLDER_DATA = [
  "14.63, 20.18, 19.85",
  "14.34, 13.09, 14.62"
];

// Cloud Run のサービスURL（末尾のスラッシュなし）
const API_BASE_URL = "https://web-tools-app-697789875302.asia-northeast1.run.app";

const { UserError, Cancelled, execute, setStatus } = ToolCommon;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Tune / Draws のステッパー（1000〜4000、1000刻み）
// ---------------------------------------------------------------------
function setupParameterStepper(name) {
  const valueElement = $(`${name}-value`);
  const decrementButton = $(`${name}-decrement`);
  const incrementButton = $(`${name}-increment`);
  let value = 1000;

  const render = () => {
    valueElement.value = String(value);
    valueElement.textContent = String(value);
    decrementButton.disabled = value <= 1000;
    incrementButton.disabled = value >= 4000;
  };

  decrementButton.addEventListener("click", () => {
    value = Math.max(1000, value - 1000);
    render();
  });
  incrementButton.addEventListener("click", () => {
    value = Math.min(4000, value + 1000);
    render();
  });
  render();

  return () => value;
}

const getTune = setupParameterStepper("tune");
const getDraws = setupParameterStepper("draws");

// ---------------------------------------------------------------------
// 結果の描画・クリア
// ---------------------------------------------------------------------
const PLOT_IDS = {
  means: "means-plot",
  forest: "forest-plot",
  differences: "differences-plot",
  trace: "trace-plot"
};
const TABLE_IDS = ["means-summary", "diagnostics", "mcse-ratios"];

/** 表を作る。1列目（Group / パラメータ名）は他ページと同じく class="col-label"（中央揃え） */
function renderTable(tableId, rows, columns, digits = 2) {
  const table = $(tableId);
  table.replaceChildren();
  if (!rows.length) return;

  const header = document.createElement("thead");
  const headerRow = document.createElement("tr");
  columns.forEach(([, label]) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headerRow.appendChild(cell);
  });
  header.appendChild(headerRow);
  table.appendChild(header);

  const body = document.createElement("tbody");
  rows.forEach(row => {
    const tableRow = document.createElement("tr");
    columns.forEach(([key], index) => {
      const cell = document.createElement("td");
      if (index === 0) cell.className = "col-label";
      const value = row[key];
      cell.textContent = typeof value === "number"
        ? (Number.isFinite(value) ? value.toFixed(digits) : "—")
        : String(value ?? "—");
      tableRow.appendChild(cell);
    });
    body.appendChild(tableRow);
  });
  table.appendChild(body);
}

function showPlots(plots) {
  Object.entries(PLOT_IDS).forEach(([key, elementId]) => {
    $(elementId).src = `data:image/png;base64,${plots[key]}`;
  });
}

/** 結果の表・画像・警告を空にする。見出しと解説は残す（Clear と、実行を始めるときに使う） */
function resetResults() {
  $("large-values").hidden = true;
  TABLE_IDS.forEach(id => $(id).replaceChildren());
  Object.values(PLOT_IDS).forEach(id => $(id).removeAttribute("src"));
}

// ---------------------------------------------------------------------
// 実行中の通信の中止（Clear で使う）
// ---------------------------------------------------------------------
let activeController = null;
let runId = 0;

function cancelRunning() {
  runId += 1;
  activeController?.abort();
  activeController = null;
}

// ---------------------------------------------------------------------
// 入力欄（ToolCommon）
// ---------------------------------------------------------------------
const input = ToolCommon.createMeansInput({
  groups: GROUPS,
  sampleData: SAMPLE_DATA,
  placeholders: PLACEHOLDER_DATA,
  onClear: () => {
    cancelRunning();
    resetResults();
  }
});

// ---------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------

/** サーバー(bayesian_means.py)は文字列を自前でパースするので、ブラウザで読み取った数値を空白区切りで渡す。
 *  （全角数字・セミコロン区切りなど、サーバー側のパースが対応していない入力も、ここで正規化される） */
function toRequestGroups(parsedGroups) {
  const groups = Object.fromEntries(GROUPS.map(name => [name, ""]));
  parsedGroups.forEach(([name, values]) => {
    const tokens = values.map(String);
    if (tokens.some(token => /e/i.test(token))) {
      throw new UserError(`Group ${name} に極端に大きい（小さい）値が含まれています。桁を下げるなどして入力してください。`);
    }
    groups[name] = tokens.join(" ");
  });
  return groups;
}

async function fetchEstimate(parsedGroups) {
  const myRun = ++runId;
  const controller = new AbortController();
  activeController = controller;

  let response;
  let data;
  try {
    response = await fetch(`${API_BASE_URL}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groups: toRequestGroups(parsedGroups),
        tune: getTune(),
        draws: getDraws()
      }),
      signal: controller.signal
    });
    // タイムアウト(504など)のときはJSONではなくHTMLが返るので、読めなかったら null にする
    data = await response.json().catch(() => null);
  } catch (error) {
    if (error.name === "AbortError") throw new Cancelled();
    throw error;
  }
  if (myRun !== runId) throw new Cancelled();   // Clear などで、この実行はもう不要になった

  if (!response.ok) {
    if (!data) {
      throw new Error(response.status === 504 || response.status === 503
        ? "サーバーの処理が時間内に終わりませんでした。件数を減らして、もう一度お試しください。"
        : `サーバーからエラーが返されました（HTTP ${response.status}）`);
    }
    const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    throw new Error(detail || `HTTP ${response.status}`);
  }
  if (!data) throw new Error("サーバーからの応答を読み取れませんでした。");
  return data;
}

function renderResults(data) {
  renderTable("means-summary", data.means_summary, [
    ["parameter", "Group"],
    ["mean", "mean"],
    ["hdi_3%", "hdi_3%"],
    ["hdi_97%", "hdi_97%"]
  ]);
  renderTable("diagnostics", data.diagnostics, [
    ["parameter", "パラメータ"],
    ["mean", "mean"],
    ["sd", "sd"],
    ["mcse_mean", "mcse_mean"],
    ["ess_bulk", "ess_bulk"],
    ["ess_tail", "ess_tail"],
    ["r_hat", "r_hat"]
  ]);
  renderTable("mcse-ratios", data.mcse_ratios, [
    ["parameter", "パラメータ"],
    ["sd", "sd"],
    ["mcse_mean", "mcse_mean"],
    ["mcse_mean / sd", "mcse_mean / sd"],
    ["mcse_mean / sd (%)", "mcse_mean / sd (%)"]
  ], 4);
  showPlots(data.plots);
  $("large-values").hidden = !data.large_values;
}

$("run-button").addEventListener("click", () => {
  const { groups: parsedGroups, groupCount } = input.getData();
  if (groupCount < 2) {
    setStatus("error", "推定には少なくとも2つの群にデータ入力が必要です。");
    return;
  }

  resetResults();   // 前回の結果は、実行を始めるときに消す
  execute({
    input,
    runningText: `${groupCount}群でベイズ推定の実行中... MCMCサンプリングが終わるまで待ってにゃん`,
    errorPrefix: "推定に失敗しました",
    work: async () => {
      renderResults(await fetchEstimate(parsedGroups));
    }
  });
});

const GROUPS = ["A", "B", "C", "D", "E"];
const SAMPLE_DATA = [
  "465.0, 458.6, 466.5, 475.2, 457.7, 457.7, 475.8, 467.7, 455.3, 465.4, 455.4, 455.3, 462.4, 440.9",
  "454.1, 471.6, 464.8, 484.7, 466.4, 458.8, 502.0, 476.6, 481.0, 458.6, 471.8, 481.7, 462.7, 485.6",
  "462.8, 466.5, 462.8, 492.2, 469.8, 457.3, 479.9, 455.3, 472.5, 446.5, 454.1, 472.4, 478.9, 472.1",
  "498.3, 495.5, 477.8, 489.2, 493.1, 515.9, 505.2, 473.6, 504.9, 494.2, 489.8, 509.2, 515.5, 514.0",
  "446.6, 451.9, 458.3, 464.8, 450.2, 453.1, 443.9, 443.0, 463.1, 468.6, 454.3, 465.0, 458.6, 448.5"
];
const PLACEHOLDER_DATA = [
  "465.0, 458.6, 466.5",
  "454.1, 471.6, 464.8"
];

// 実行中は true（実行ボタンを無効にしておくための印）
let isEstimating = false;

const PYODIDE_VERSION = "v0.27.7";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;
let pyodidePromise = null;

function loadPyodideRuntime() {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${PYODIDE_BASE}pyodide.js`;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Pyodideの読み込みに失敗しました"));
      document.head.appendChild(script);
    });
    const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
    await pyodide.loadPackage(["numpy", "scipy", "matplotlib"]);
    pyodide.runPython(CLASSICAL_MEANS_PY);
    return pyodide;
  })().catch((error) => {
    pyodidePromise = null;
    throw error;
  });
  return pyodidePromise;
}

// 次の描画が終わるまで待つ（Pythonの計算は画面を固めるので、その前に状態メッセージを描画させる）
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const groupInputs = document.getElementById("group-inputs");
GROUPS.forEach(name => {
  const group = document.createElement("div");
  group.className = `input-group group-${name.toLowerCase()}`;
  const header = document.createElement("div");
  header.className = "input-group-header";
  const label = document.createElement("label");
  label.htmlFor = `group-${name}`;
  label.textContent = `Group ${name}`;
  const clearButton = document.createElement("button");
  clearButton.id = `clear-group-${name}`;
  clearButton.className = "input-clear-button";
  clearButton.type = "button";
  clearButton.textContent = "×";
  clearButton.setAttribute("aria-label", `Group ${name} のデータをクリア`);
  clearButton.hidden = true;
  const textarea = document.createElement("textarea");
  textarea.id = `group-${name}`;
  textarea.name = `group-${name}`;
  textarea.placeholder = PLACEHOLDER_DATA[GROUPS.indexOf(name)] ?? "";
  textarea.setAttribute("aria-label", `Group ${name} のデータ`);
  textarea.addEventListener("input", () => {
    updateInputClearButton(name);
    updateConfirmationTable();
  });
  clearButton.addEventListener("click", () => {
    textarea.value = "";
    updateInputClearButton(name);
    updateConfirmationTable();
    textarea.focus();
  });
  header.append(label, clearButton);
  group.append(header, textarea);
  groupInputs.appendChild(group);
});
groupInputs.appendChild(groupInputs.querySelector(".sample-buttons"));

function updateInputClearButton(name) {
  const textarea = document.getElementById(`group-${name}`);
  const clearButton = document.getElementById(`clear-group-${name}`);
  clearButton.hidden = textarea.value.trim() === "";
}

document.getElementById("sample-button").addEventListener("click", () => {
  const hasInput = GROUPS.some(name =>
    document.getElementById(`group-${name}`).value.trim() !== ""
  );
  if (hasInput && !window.confirm("入力データをサンプルデータで置き換えます。よろしいですか？")) {
    return;
  }

  GROUPS.forEach((name, index) => {
    document.getElementById(`group-${name}`).value = SAMPLE_DATA[index];
    updateInputClearButton(name);
  });
  updateConfirmationTable();
});

document.getElementById("clear-button").addEventListener("click", () => {
  GROUPS.forEach(name => {
    document.getElementById(`group-${name}`).value = "";
    updateInputClearButton(name);
  });
  clearResults();
  document.getElementById("running-message").hidden = true;
  document.getElementById("running-message-text").textContent = "";
  document.getElementById("completion-message").hidden = true;
  document.getElementById("error-message").hidden = true;
  document.getElementById("error-message-text").textContent = "";
  delete document.getElementById("error-message").dataset.inputError;
  document.getElementById("initial-message").hidden = false;
  updateConfirmationTable();
});

function getParsedGroups() {
  return GROUPS.map(name => {
    const raw = document.getElementById(`group-${name}`).value;
    const cleaned = raw.replace(/(?<=\d),(?=\d)/g, "");
    const tokens = cleaned.split(/[^0-9.-]+/).filter(token => token.trim());
    const values = tokens.map(token => Number(token));
    if (values.some(value => !Number.isFinite(value))) {
      throw new Error(`Group ${name} の入力に数値として解釈できない部分があります。`);
    }
    return [name, values];
  }).filter(([, values]) => values.length > 0);
}

function getConfirmationRows(parsedGroups) {
  return parsedGroups.map(([name, values]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
      : NaN;
    return {
      Group: name,
      N: values.length.toLocaleString(),
      Mean: mean.toFixed(2),
      Std: Number.isFinite(variance) ? Math.sqrt(variance).toFixed(2) : "",
      Min: Math.min(...values).toFixed(2),
      Max: Math.max(...values).toFixed(2)
    };
  });
}

function updateConfirmationTable() {
  const errorMessage = document.getElementById("error-message");
  const errorMessageText = document.getElementById("error-message-text");
  try {
    const parsedGroups = getParsedGroups();
    const rows = getConfirmationRows(parsedGroups);
    const rowsByGroup = new Map(rows.map(row => [row.Group, row]));
    document.querySelectorAll("#confirmation-table tbody tr").forEach(tableRow => {
      const row = rowsByGroup.get(tableRow.dataset.group);
      const cells = tableRow.querySelectorAll("td");
      cells[0].textContent = row?.N ?? "";
      cells[1].textContent = row?.Mean ?? "";
      cells[2].textContent = row?.Std ?? "";
      cells[3].textContent = row?.Min ?? "";
      cells[4].textContent = row?.Max ?? "";
    });
    document.getElementById("run-button").disabled = isEstimating || parsedGroups.length === 0;
    if (errorMessage.dataset.inputError) {
      errorMessage.hidden = true;
      errorMessageText.textContent = "";
      delete errorMessage.dataset.inputError;
    }
  } catch (error) {
    document.querySelectorAll("#confirmation-table tbody td").forEach(cell => {
      cell.textContent = "";
    });
    document.getElementById("run-button").disabled = true;
    errorMessageText.textContent = error.message;
    errorMessage.dataset.inputError = "true";
    errorMessage.hidden = false;
  }
}

const RESULT_IDS = ["group-table", "group-chart", "omni-summary", "pair-t-table", "pair-adj-table", "pair-adj-chart", "pair-adj-ci-table"];

function clearResults() {
  RESULT_IDS.forEach(id => { document.getElementById(id).replaceChildren(); });
}

/**
 * Welch ANOVAの結果文（HTMLに挿入するので、数値のみを埋め込む）
 */
function renderOmniSummary(omni, alpha) {
  const verdict = omni.significant
    ? `有意（p &lt; ${alpha}）：少なくとも1つの群の平均が他と異なります`
    : `有意差なし（p ≥ ${alpha}）`;
  const pText = omni.p < 0.0001 ? omni.p.toExponential(2) : omni.p.toFixed(4);
  return `<ul>
      <li>Welch ANOVA: F(${omni.df1}, ${omni.df2.toFixed(1)}) = ${omni.f.toFixed(3)}, p = ${pText}</li>
      <li>結果: <strong>${verdict}</strong></li>
    </ul>`;
}

/**
 * 差の信頼区間グラフの線・丸印に、マウスオン時の値表示を付ける
 * （要素のidは classical-means-py.js の set_gid と対応: {prefix}-ci-{method}-{行} / {prefix}-mean-{method}-{行}）
 */
function addPairChartTooltips(chart, prefix, items, level) {
  const svg = chart.querySelector("svg");
  if (!svg) {
    throw new Error("ペア比較グラフのSVGが見つかりません");
  }
  const tooltip = document.createElement("div");
  tooltip.className = "pair-chart-tooltip";
  tooltip.setAttribute("role", "tooltip");
  chart.appendChild(tooltip);

  const methods = { unadjusted: "補正なし", bonferroni: "Bonferroni", tukey: "Tukey" };
  const attach = (id, text) => {
    const element = svg.querySelector(`[id="${id}"]`);
    if (!element) {
      throw new Error(`グラフ要素が見つかりません: ${id}`);
    }
    element.setAttribute("aria-label", text);
    const position = (event) => {
      tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8)}px`;
      tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - tooltip.offsetHeight - 8)}px`;
    };
    element.addEventListener("pointerenter", (event) => {
      tooltip.textContent = text;
      tooltip.classList.add("visible");
      position(event);
    });
    element.addEventListener("pointermove", position);
    element.addEventListener("pointerleave", () => tooltip.classList.remove("visible"));
  };

  items.forEach((item, row) => {
    Object.entries(methods).forEach(([method, label]) => {
      const interval = item.intervals[method];
      if (!interval || !svg.querySelector(`[id="${prefix}-ci-${method}-${row}"]`)) return;
      attach(`${prefix}-ci-${method}-${row}`,
        `${item.pair} / ${label} ${level}% CI: ${interval[0].toFixed(2)}〜${interval[1].toFixed(2)}`);
      attach(`${prefix}-mean-${method}-${row}`,
        `${item.pair} / ${label} difference estimate: ${item.diff.toFixed(2)}`);
    });
  });
}

document.getElementById("run-button").addEventListener("click", async () => {
  const button = document.getElementById("run-button");
  const runningMessage = document.getElementById("running-message");
  const runningMessageText = document.getElementById("running-message-text");
  const completionMessage = document.getElementById("completion-message");
  const initialMessage = document.getElementById("initial-message");
  const errorMessage = document.getElementById("error-message");
  const errorMessageText = document.getElementById("error-message-text");

  const showError = (message) => {
    runningMessage.hidden = true;
    errorMessageText.textContent = message;
    errorMessage.hidden = false;
  };

  isEstimating = true;
  button.disabled = true;
  initialMessage.hidden = true;
  completionMessage.hidden = true;
  errorMessage.hidden = true;
  delete errorMessage.dataset.inputError;
  runningMessage.hidden = true;

  try {
    const parsedGroups = getParsedGroups();
    if (parsedGroups.length < 2) {
      return showError("検定には少なくとも2つの群にデータ入力が必要です。");
    }
    const tooSmall = parsedGroups.find(([, values]) => values.length < 2);
    if (tooSmall) {
      return showError(`Group ${tooSmall[0]} は2件以上のデータが必要です。`);
    }

    runningMessageText.textContent = `${parsedGroups.length}群で検定の実行中... 終わるまで待ってにゃん`;
    runningMessage.hidden = false;

    const pyodide = await loadPyodideRuntime();
    await nextPaint();   // ここで状態メッセージを描画させてから、計算に入る
    const alpha = parseFloat(document.getElementById("alpha-select").value);
    const runFn = pyodide.globals.get("run");
    const result = JSON.parse(runFn(
      parsedGroups.map(([name]) => name), parsedGroups.map(([, values]) => values), alpha));
    runFn.destroy();

    if (result.error) {
      return showError(result.error);
    }

    document.getElementById("group-table").innerHTML = result.group_table;
    document.getElementById("group-chart").innerHTML = result.group_chart;
    document.getElementById("omni-summary").innerHTML = renderOmniSummary(result.omni, alpha);
    const multi = parsedGroups.length >= 3;
    document.getElementById("omni-skipped").hidden = multi;
    document.getElementById("pair-section").hidden = !multi;
    document.getElementById("pair-t-table").innerHTML = result.pair_table;
    document.getElementById("pair-adj-ci-table").innerHTML = result.adj_ci_table ?? "";
    const adjChart = document.getElementById("pair-adj-chart");
    adjChart.innerHTML = result.adj_chart ?? "";
    if (result.adj_chart) {
      addPairChartTooltips(adjChart, "adjpair", result.chart_tooltips, result.level);
    }
    document.getElementById("pair-adj-table").innerHTML = result.adj_table;

    runningMessage.hidden = true;
    completionMessage.hidden = false;
  } catch (error) {
    console.error(error);
    showError(`検定に失敗しました: ${error.message}`);
  } finally {
    isEstimating = false;
    updateConfirmationTable();
  }
});

updateConfirmationTable();

// 初回ロードに時間がかかるため、先に裏で読み込んでおく
loadPyodideRuntime().catch(console.error);


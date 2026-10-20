const GROUPS = ["A", "B", "C", "D", "E"];
const SAMPLE_DATA = [
  "14.63, 20.18, 19.85, 20.86, 20.01, 16.96, 17.66, 18.46, 16.19, 15.76, 14.84, 20.56, 15.09, 17.18",
  "14.34, 13.09, 14.62, 14.31, 19.25, 13.03, 13.56, 13.07, 17.93, 15.09, 14.56, 15.51, 15.06, 17.36",
  "20.43, 24.43, 24.2, 17.74, 20.75, 18.87, 18.13, 17.01, 19.4, 17.37, 17.67, 23.76, 18.99, 23.72",
  "6.75, 17.33, 18.26, 20.43, 17.38, 17.34, 20.08, 16.26, 16.19, 18.88, 16.96, 20.56, 15.53, 16.75",
  "14.54, 15.4, 12.52, 18.74, 12.64, 16.48, 13.61, 16.12, 13.93, 17.89, 12.44, 12.51, 17.24, 14.29"
];

// TODO: Replace with the deployed Cloud Run service URL (without a trailing slash).
const API_BASE_URL = "https://web-tools-app-697789875302.asia-northeast1.run.app";
let activeRequestController = null;
let requestVersion = 0;

const groupInputs = document.getElementById("group-inputs");
GROUPS.forEach(name => {
  const label = document.createElement("label");
  label.className = "group-input";
  label.htmlFor = `group-${name}`;
  label.append(`Group ${name}`);
  const textarea = document.createElement("textarea");
  textarea.id = `group-${name}`;
  textarea.name = `group-${name}`;
  textarea.setAttribute("aria-label", `Group ${name} のデータ`);
  label.appendChild(textarea);
  groupInputs.appendChild(label);
});

document.getElementById("sample-button").addEventListener("click", () => {
  GROUPS.forEach((name, index) => {
    document.getElementById(`group-${name}`).value = SAMPLE_DATA[index];
  });
});

document.getElementById("clear-button").addEventListener("click", () => {
  GROUPS.forEach(name => {
    document.getElementById(`group-${name}`).value = "";
  });
});

const tabs = [...document.querySelectorAll('[role="tab"]')];
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
    });
  });
});

function renderTable(tableId, rows, columns, digits = 2) {
  const table = document.getElementById(tableId);
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
    columns.forEach(([key]) => {
      const cell = document.createElement("td");
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
  const plotIds = {
    means: "means-plot",
    forest: "forest-plot",
    differences: "differences-plot",
    trace: "trace-plot"
  };
  Object.entries(plotIds).forEach(([key, elementId]) => {
    document.getElementById(elementId).src = `data:image/png;base64,${plots[key]}`;
  });
}

function clearResults() {
  document.getElementById("observations").replaceChildren();
  document.getElementById("means-summary").replaceChildren();
  document.getElementById("diagnostics").replaceChildren();
  document.getElementById("mcse-ratios").replaceChildren();
  document.querySelectorAll(".plot").forEach(plot => plot.removeAttribute("src"));
  document.querySelectorAll("#results details").forEach(details => {
    details.open = details.querySelector("summary")?.textContent.trim() === "Summary";
  });
}

function resetView() {
  requestVersion += 1;
  activeRequestController?.abort();
  activeRequestController = null;

  document.getElementById("estimate-button").disabled = false;
  document.getElementById("results").hidden = true;
  document.getElementById("observations-section").hidden = true;
  document.getElementById("large-values").hidden = true;
  document.getElementById("intro").hidden = false;
  document.getElementById("running-message").hidden = true;
  document.getElementById("completion-message").hidden = true;
  document.getElementById("error-message").hidden = true;
  document.getElementById("running-message-text").textContent = "";
  tabs.forEach((tab, index) => {
    const selected = index === 0;
    tab.setAttribute("aria-selected", String(selected));
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  });
  clearResults();
}

document.getElementById("reset-button").addEventListener("click", resetView);

document.getElementById("estimate-button").addEventListener("click", async () => {
  const version = ++requestVersion;
  const controller = new AbortController();
  activeRequestController = controller;
  const button = document.getElementById("estimate-button");
  const results = document.getElementById("results");
  const largeValues = document.getElementById("large-values");
  const intro = document.getElementById("intro");
  const observationsSection = document.getElementById("observations-section");
  const runningMessage = document.getElementById("running-message");
  const runningMessageText = document.getElementById("running-message-text");
  const completionMessage = document.getElementById("completion-message");
  const errorMessage = document.getElementById("error-message");

  button.disabled = true;
  results.hidden = true;
  observationsSection.hidden = true;
  largeValues.hidden = true;
  intro.hidden = true;
  completionMessage.hidden = true;
  errorMessage.hidden = true;
  runningMessage.hidden = true;

  try {
    if (API_BASE_URL.includes("YOUR_CLOUD_RUN_SERVICE")) {
      throw new Error("JavaScript内のAPI_BASE_URLをCloud RunのURLに変更してください。");
    }

    const groups = Object.fromEntries(GROUPS.map(name => [
      name,
      document.getElementById(`group-${name}`).value
    ]));
    const parsedGroups = Object.entries(groups).map(([name, raw]) => {
      const cleaned = raw.replace(/(?<=\d),(?=\d)/g, "");
      const tokens = cleaned.split(/[^0-9.-]+/).filter(token => token.trim());
      const values = tokens.map(token => Number(token));
      if (values.some(value => !Number.isFinite(value))) {
        throw new Error(`Group ${name} の入力に数値として解釈できない部分があります。`);
      }
      return [name, values];
    }).filter(([, values]) => values.length > 0);

    if (parsedGroups.length < 2) {
      throw new Error("推定には少なくとも2つの群にデータ入力が必要です。");
    }
    const observationRows = parsedGroups.map(([name, values]) => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      return {
        Group: name,
        "データ件数": values.length,
        "平均値 (Mean)": mean,
        "標準偏差 (Std)": Math.sqrt(variance),
        "最小値": Math.min(...values),
        "最大値": Math.max(...values)
      };
    });
    renderTable("observations", observationRows, [
      ["Group", "Group"],
      ["データ件数", "データ件数"],
      ["平均値 (Mean)", "平均値 (Mean)"],
      ["標準偏差 (Std)", "標準偏差 (Std)"],
      ["最小値", "最小値"],
      ["最大値", "最大値"]
    ]);
    observationsSection.hidden = false;
    runningMessageText.textContent = `${parsedGroups.length}群でベイズ推定の実行中... MCMCサンプリングが終わるまで待ってにゃん`;
    runningMessage.hidden = false;

    const response = await fetch(`${API_BASE_URL}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groups,
        tune: Number(document.getElementById("tune").value),
        draws: Number(document.getElementById("draws").value)
      }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
      throw new Error(detail || `HTTP ${response.status}`);
    }

    if (version !== requestVersion) return;

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
    largeValues.hidden = !data.large_values;
    results.hidden = false;
    runningMessage.hidden = true;
    completionMessage.textContent = "推定完了！解説やPointを参考にしながら推定結果を読み解いてください。";
    completionMessage.hidden = false;
  } catch (error) {
    if (error.name === "AbortError" || version !== requestVersion) return;
    runningMessage.hidden = true;
    errorMessage.textContent = `推定に失敗しました: ${error.message}`;
    errorMessage.hidden = false;
  } finally {
    if (version === requestVersion) {
      button.disabled = false;
      activeRequestController = null;
    }
  }
});

// =====================================================================
// classical-means.html 用のJS。このページ専用の部分（サンプルデータ・結果の描画・実行ボタンの処理）だけを書く。
// 入力欄・確認表・状態メッセージ・Pyodide・ツールチップは tool-common.js（ToolCommon）が担当。
//
// 【仕組み】
//  - 計算とグラフ描画は classical-means-py.js 内のPythonコード（CLASSICAL_MEANS_PY）がPyodide上で行う。
//    Pythonの run() は表(HTML)とグラフ(SVG)をJSONで返し、ここで下記idのdivに挿入する。
//      #omni-summary                       （Welch ANOVA。omni から文章を作る。2群のときは null）
//      #group-table / #group-chart         （各群の平均と信頼区間）
//      #pair-t-table                       （Welchのt検定の詳細）
//      #pair-p-table / #pair-ci-table / #pair-chart  （各群間の検定結果と信頼区間）
//  - これらのidは classical-means.html と classical-means.css に対応する。
//    id を変える時は html / css / このファイル（と py.js の戻り値のキー）を同時に直すこと。
//  - 群ごとの入力欄は、ToolCommon.createMeansInput() が #group-inputs の中に作る（HTMLには書いていない）。
//  - 確認表(#confirmation-table)は、HTML側に5行(data-group="A〜E")を固定で書いてあり、
//    ToolCommon が各セルの文字だけを更新する。
//  - Pyodideはページ表示時に裏で読み込み開始（初回のみ数秒〜）。
// =====================================================================
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

ToolCommon.configurePyodide({
  packages: ['numpy', 'scipy', 'matplotlib'],
  sources: [TOOL_COMMON_PY, CLASSICAL_MEANS_PY],
});

// 結果を入れるdivのid（Clear で空にする）
const RESULT_IDS = ['group-table', 'group-chart', 'omni-summary', 'pair-t-table', 'pair-p-table', 'pair-chart', 'pair-ci-table'];

function clearResults() {
  ToolCommon.clearElements(RESULT_IDS);
}

const input = ToolCommon.createMeansInput({
  groups: GROUPS, sampleData: SAMPLE_DATA, placeholders: PLACEHOLDER_DATA, onClear: clearResults,
});

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
 * Pythonの結果を画面に入れる
 */
function renderResults(result, alpha) {
  document.getElementById('group-table').innerHTML = result.group.table;
  document.getElementById('group-chart').innerHTML = result.group.chart;
  document.getElementById('omni-summary').innerHTML = renderOmniSummary(result.omni, alpha);

  document.getElementById('pair-t-table').innerHTML = result.pair.t_table;
  document.getElementById('pair-ci-table').innerHTML = result.pair.ci_table;
  const pairChart = document.getElementById('pair-chart');
  pairChart.innerHTML = result.pair.chart;
  ToolCommon.attachPairChartTooltips(pairChart, {
    prefix: 'pair', items: result.pair.tooltips, level: result.pair.level,
  });
  document.getElementById('pair-p-table').innerHTML = result.pair.p_table;
}

/**
 * 実行ボタン：Pyodideで計算・描画して画面に反映
 */
async function runTest() {
  const { groups, groupCount } = input.getData();
  if (groupCount < 2) {
    return ToolCommon.setStatus('error', '検定には少なくとも2つの群にデータ入力が必要です。', { inputError: true });
  }
  const tooSmall = groups.find(([, values]) => values.length < 2);
  if (tooSmall) {
    return ToolCommon.setStatus('error', `Group ${tooSmall[0]} は2件以上のデータが必要です。`, { inputError: true });
  }
  const alpha = parseFloat(document.getElementById('alpha-select').value);

  await ToolCommon.execute({
    input,
    runningText: `${groupCount}群で検定の実行中... 終わるまで待ってにゃん`,
    errorPrefix: '検定に失敗しました',
    work: async () => {
      const result = await ToolCommon.callPython('run',
        groups.map(([name]) => name), groups.map(([, values]) => values), alpha);
      if (result.error) throw new ToolCommon.UserError(result.error);
      renderResults(result, alpha);
    },
  });
}

document.getElementById('run-button').addEventListener('click', runTest);

// 初回ロードに時間がかかるため、先に裏で読み込んでおく
ToolCommon.preloadPyodide();

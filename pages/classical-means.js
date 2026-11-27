// =====================================================================
// classical-means.html 用のJS。このページ専用の部分（サンプルデータ・結果の描画・実行ボタンの処理）だけを書く。
// 入力欄・確認表・状態メッセージ・Pyodide・ツールチップは tool-common.js（ToolCommon）が担当。
//
// 【仕組み】
//  - 計算とグラフ描画は classical-means-py.js 内のPythonコード（CLASSICAL_MEANS_PY）がPyodide上で行う。
//    Pythonの run() は表(HTML)とグラフ(SVG)をJSONで返し、ここで下記idのdivに挿入する。
//      #omni-summary                       （Welch ANOVA。omni から文章を作る。2群のときは null）
//      #group-table / #group-chart         （各群の平均と信頼区間）
//      #pair-table / #pair-chart           （群間の差の主表と主グラフ: p (Holm) と Bonferroni同時CI）
//      #pair-adjust-details の中           （3群以上のときだけ表示: #pair-p-table 補正方法別のp値 /
//                                          #pair-chart-all 補正なし・Bonferroniの2本のCI / #pair-ci-table CIの表）
//  - これらのidは classical-means.html と page-common.css とHTMLの <style> に対応する。
//    id を変える時は html / css / このファイル（と py.js の戻り値のキー）を同時に直すこと。
//  - 群ごとの入力欄は、ToolCommon.createMeansInput() が #group-inputs の中に作る（HTMLには書いていない）。
//  - 確認表(#confirmation-table)は、HTML側に5行(data-group="A〜E")を固定で書いてあり、
//    ToolCommon が各セルの文字だけを更新する。
//  - Pyodideはページ表示時に裏で読み込み開始（初回のみ数秒〜）。
//  - 結果欄は「全体動向」「群間の差」の2タブ（HTMLの .result-tabs）。切り替えは ToolCommon.createResultTabs() が担当し、
//    Clear のときは既定のタブ（全体動向）に戻す。
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
const RESULT_IDS = ['group-table', 'group-chart', 'omni-summary', 'pair-table', 'pair-chart',
  'pair-p-table', 'pair-chart-all', 'pair-ci-table'];

// 結果タブ（「全体動向」「群間の差」）。Clear のときは既定のタブに戻す
const resultTabs = ToolCommon.createResultTabs();

function clearResults() {
  ToolCommon.clearElements(RESULT_IDS);
  document.getElementById('pair-count').textContent = '';
  document.getElementById('pair-adjust-single').hidden = true;
  const details = document.getElementById('pair-adjust-details');
  details.hidden = true;
  details.open = false;
  if (resultTabs) resultTabs.reset();
}

const input = ToolCommon.createMeansInput({
  groups: GROUPS, sampleData: SAMPLE_DATA, placeholders: PLACEHOLDER_DATA, onClear: clearResults,
});

/**
 * Welch ANOVAの結果文（HTMLに挿入するので、数値のみを埋め込む）
 */
function renderOmniSummary(omni, alpha) {
  const verdict = omni.significant
    ? `有意差あり（p ≤ ${alpha}）少なくとも1つの群の平均が他と異なります`
    : `有意差なし（p &gt; ${alpha}）`;
  const pText = omni.p < 0.0001 ? omni.p.toExponential(2) : omni.p.toFixed(4);
  return `<ul>
      <li>Welch ANOVA: F(${omni.df1}, ${omni.df2.toFixed(1)}) = ${omni.f.toFixed(3)}, p = ${pText}</li>
      <li>結果: <strong>${verdict}</strong></li>
    </ul>`;
}

/**
 * 「多重比較の補正」の表示切り替え。2群（ペア数 1）のときは補正が不要なので details ごと隠し、短い説明だけを出す。
 * h3「多重比較の補正」自体は常に表示する。
 */
function setAdjustVisible(multi) {
  const details = document.getElementById('pair-adjust-details');
  details.hidden = !multi;
  if (!multi) details.open = false;
  document.getElementById('pair-adjust-single').hidden = multi;
}

/**
 * Pythonの結果を画面に入れる
 */
function renderResults(result, alpha) {
  document.getElementById('group-table').innerHTML = result.group.table;
  document.getElementById('group-chart').innerHTML = result.group.chart;
  document.getElementById('omni-summary').innerHTML = renderOmniSummary(result.omni, alpha);

  document.getElementById('pair-count').textContent = `${result.pair.pairs} ペア / 有意水準 ${alpha}`;
  document.getElementById('pair-table').innerHTML = result.pair.table;
  document.getElementById('pair-p-table').innerHTML = result.pair.p_table;
  document.getElementById('pair-ci-table').innerHTML = result.pair.ci_table;
  setAdjustVisible(result.pair.pairs > 1);

  // 主グラフ（Bonferroni）と details 内のグラフ（補正なし + Bonferroni）は、要素idの接頭辞が違う（pair / pair-all）
  const tip = { items: result.pair.tooltips, level: result.pair.level };
  const pairChart = document.getElementById('pair-chart');
  pairChart.innerHTML = result.pair.chart;
  ToolCommon.attachPairChartTooltips(pairChart, { prefix: 'pair', ...tip });
  const pairChartAll = document.getElementById('pair-chart-all');
  pairChartAll.innerHTML = result.pair.chart_all;
  ToolCommon.attachPairChartTooltips(pairChartAll, { prefix: 'pair-all', ...tip });
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

// =====================================================================
// classical-props.html 用のJS。このページ専用の部分（サンプルデータ・結果の描画・実行ボタンの処理）だけを書く。
// 入力欄・確認表・状態メッセージ・Pyodide・ツールチップは tool-common.js（ToolCommon）が担当。
//
// 【仕組み】
//  - 計算とグラフ描画は classical-props-py.js 内のPythonコード（CLASSICAL_PROPS_PY）がPyodide上で行う。
//    Pythonの run() は表(HTML)とグラフ(SVG)をJSONで返し、ここで下記idのdivに挿入する。
//      #omni-summary                       （全体の検定。omni から文章を作る）
//      #group-table / #group-chart         （各群の比率とWilson区間）
//      #pair-p-table / #pair-ci-table / #pair-chart  （各群間の検定結果と信頼区間）
//  - これらのidは classical-props.html と page-common.css とHTMLの <style> に対応する。
//    id を変える時は html / css / このファイル（と py.js の戻り値のキー）を同時に直すこと。
//  - 確認表(#confirmation-table)は、HTML側に5行(Group A〜E)を固定で書いてあり、
//    ToolCommon が各セルの文字だけを更新する（行数が変わらないので、下のパーツがずれない）。
//  - 状態メッセージは ToolCommon.setStatus() が #initial-message / #running-message / #completion-message / #error-message を切り替える。
//  - Pyodideはページ表示時に裏で読み込み開始（初回のみ数秒〜）。
// =====================================================================

// 「サンプルデータ」ボタンで入るデータ
const SAMPLE = { denoms: "1000 2000 1500 1200 1600", numers: "70 120 95 110 150" };

ToolCommon.configurePyodide({
  packages: ['numpy', 'scipy', 'matplotlib'],
  sources: [TOOL_COMMON_PY, CLASSICAL_PROPS_PY],
});

// 結果を入れるdivのid（Clear で空にする）
const RESULT_IDS = ['omni-summary', 'group-table', 'group-chart', 'pair-p-table', 'pair-ci-table', 'pair-chart'];

function clearResults() {
  ToolCommon.clearElements(RESULT_IDS);
  document.getElementById('pair-count').textContent = '';
}

const input = ToolCommon.createPropsInput({ sample: SAMPLE, onClear: clearResults });

/**
 * 全体の検定結果の要約文（HTMLに挿入するので、数値のみを埋め込む）
 */
function renderOmniSummary(omni, alpha) {
  const verdict = omni.significant
    ? `有意（p &lt; ${alpha}）：少なくとも1つの群の比率が他と異なります`
    : `有意差なし（p ≥ ${alpha}）`;
  const pText = omni.p < 0.0001 ? omni.p.toExponential(2) : omni.p.toFixed(4);
  const warn = omni.low_expected
    ? '<p class="mdc-warn-box">注意: 期待度数が5未満のセルがあります。カイ二乗近似の精度が低い可能性があります。</p>'
    : '';
  return `<ul>
      <li>Pearson chi-squared = ${omni.chi2.toFixed(4)}, df = ${omni.df}, p = ${pText}, Cramér's V = ${omni.v.toFixed(4)}</li>
      <li>結果: <strong>${verdict}</strong></li>
    </ul>${warn}`;
}

/**
 * Pythonの結果を画面に入れる
 */
function renderResults(result, alpha) {
  document.getElementById('omni-summary').innerHTML = renderOmniSummary(result.omni, alpha);
  document.getElementById('group-table').innerHTML = result.group.table;
  document.getElementById('group-chart').innerHTML = result.group.chart;

  document.getElementById('pair-p-table').innerHTML = result.pair.p_table;
  document.getElementById('pair-count').textContent = `${result.pair.pairs} ペア / 有意水準 ${alpha}`;
  document.getElementById('pair-ci-table').innerHTML = result.pair.ci_table;
  const pairChart = document.getElementById('pair-chart');
  pairChart.innerHTML = result.pair.chart;
  ToolCommon.attachPairChartTooltips(pairChart, {
    prefix: 'pair', items: result.pair.tooltips, level: result.pair.level, unit: ' points',
  });
}

/**
 * 実行ボタン：Pyodideで計算・描画して画面に反映
 */
async function runTest() {
  const { denoms, numers, groupCount } = input.getData();
  if (groupCount < 2) {
    return ToolCommon.setStatus('error',
      '検定には少なくとも2群のデータが必要にゃん。手元にデータがなければ「Sample Data」ボタンで試してにゃん',
      { inputError: true });
  }
  const alpha = parseFloat(document.getElementById('alpha-select').value);

  await ToolCommon.execute({
    input,
    runningText: `${groupCount}群で検定の実行中... 終わるまで待ってにゃん`,
    errorPrefix: '検定に失敗しました',
    work: async () => {
      const result = await ToolCommon.callPython('run',
        denoms.slice(0, groupCount), numers.slice(0, groupCount), alpha);
      renderResults(result, alpha);
    },
  });
}

document.getElementById('run-button').addEventListener('click', runTest);

// 初回ロードに時間がかかるため、先に裏で読み込んでおく
ToolCommon.preloadPyodide();

// =====================================================================
// classical-props.html 用のJS。このページ専用の部分（サンプルデータ・結果の描画・実行ボタンの処理）だけを書く。
// 入力欄・確認表・状態メッセージ・Pyodide・ツールチップは tool-common.js（ToolCommon）が担当。
//
// 【仕組み】
//  - 計算とグラフ描画は classical-props-py.js 内のPythonコード（CLASSICAL_PROPS_PY）がPyodide上で行う。
//    Pythonの run() は表(HTML)とグラフ(SVG)をJSONで返し、ここで下記idのdivに挿入する。
//      #omni-summary                       （全体の検定。omni から文章を作る）
//      #group-table / #group-chart         （各群の Sample Size・Events・比率とWilson区間）
//      #pair-table / #pair-chart / #pair-ci-note  （群間の差の主表・主グラフ・CIの臨界値: p (Holm) と Bonferroni同時CI）
//      #pair-warning                       （期待度数が小さいペア等の注意。pair.warnings から文章を作る）
//      #pair-adjust-details の中           （3群以上のときだけ表示: #pair-p-table 補正方法別のp値 /
//                                          #pair-chart-all 補正なし・Bonferroniの2本のCI / #pair-ci-table / #pair-ci-note-all）
//  - これらのidは classical-props.html と page-common.css とHTMLの <style> に対応する。
//    id を変える時は html / css / このファイル（と py.js の戻り値のキー）を同時に直すこと。
//  - 確認表(#confirmation-table)は、HTML側に5行(Group A〜E)を固定で書いてあり、
//    ToolCommon が各セルの文字だけを更新する（行数が変わらないので、下のパーツがずれない）。
//  - 状態メッセージは ToolCommon.setStatus() が #initial-message / #running-message / #completion-message / #error-message を切り替える。
//  - Pyodideはページ表示時に裏で読み込み開始（初回のみ数秒〜）。
//  - 結果欄は「全体動向」「群間の差」の2タブ（HTMLの .result-tabs）。切り替えは ToolCommon.createResultTabs() が担当し、
//    Clear のときは既定のタブ（全体動向）に戻す。
// =====================================================================

// 「サンプルデータ」ボタンで入るデータ
const SAMPLE = { denoms: "1000 2000 1500 1200 1600", numers: "70 120 95 110 150" };

ToolCommon.configurePyodide({
  packages: ['numpy', 'scipy', 'matplotlib'],
  sources: [TOOL_COMMON_PY, CLASSICAL_PROPS_PY],
});

// 結果を入れるdivのid（Clear で空にする）
const RESULT_IDS = ['omni-summary', 'group-table', 'group-chart', 'pair-table', 'pair-warning',
  'pair-p-table', 'pair-ci-table', 'pair-ci-note', 'pair-ci-note-all',
  'pair-chart', 'pair-chart-all'];

// 結果タブ。Clear のときは既定のタブに戻す
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

const input = ToolCommon.createPropsInput({ sample: SAMPLE, onClear: clearResults });

/**
 * 全体の検定結果の要約文（HTMLに挿入するので、数値のみを埋め込む）
 */
function renderOmniSummary(omni, alpha) {
  const verdict = omni.significant
    ? `有意差あり（p &lt; ${alpha}）少なくとも1つの群の比率が他と異なります`
    : `有意差なし（p ≥ ${alpha}）`;
  const pText = omni.p < 0.0001 ? omni.p.toExponential(2) : omni.p.toFixed(4);
  const warn = omni.low_expected
    ? '<p class="mdc-warn-box">注意: 期待度数が5未満のセルがあります。カイ二乗近似の精度が低い可能性があります。</p>'
    : '';
  return `<ul>
      <li>Pearson chi-squared = ${omni.chi2.toFixed(4)}, dof = ${omni.dof}, p = ${pText}, Cramér's V = ${omni.v.toFixed(4)}</li>
      <li>合計 N = ${omni.n.toLocaleString()}, 期待度数の最小値 = ${omni.min_expected.toFixed(2)}</li>
      <li>結果: <strong>${verdict}</strong></li>
    </ul>${warn}`;
}

/**
 * ペアごとの注意書き（期待度数が小さいペア / 検定できず p = 1.0 にしたペア）。なければ空
 */
function renderPairWarnings(warnings) {
  const items = [];
  if (warnings.low_expected.length) {
    items.push(`<li>† ${warnings.low_expected.join('、')}: 期待度数が5未満のセルがあります。カイ二乗近似の精度が低い可能性があります。</li>`);
  }
  if (warnings.degenerate.length) {
    items.push(`<li>‡ ${warnings.degenerate.join('、')}: 期待度数が0のセルがあり検定できないため、χ² と dof は算出せず p = 1.0 としています。</li>`);
  }
  return items.length ? `<div class="mdc-warn-box"><ul>${items.join('')}</ul></div>` : '';
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
  document.getElementById('omni-summary').innerHTML = renderOmniSummary(result.omni, alpha);
  document.getElementById('group-table').innerHTML = result.group.table;
  document.getElementById('group-chart').innerHTML = result.group.chart;

  document.getElementById('pair-table').innerHTML = result.pair.table;
  document.getElementById('pair-warning').innerHTML = renderPairWarnings(result.pair.warnings);
  document.getElementById('pair-count').textContent = `${result.pair.pairs} ペア / 有意水準 ${alpha}`;
  document.getElementById('pair-p-table').innerHTML = result.pair.p_table;
  document.getElementById('pair-ci-table').innerHTML = result.pair.ci_table;
  const multi = result.pair.pairs > 1;
  setAdjustVisible(multi);

  // CIの臨界値の注記（主表の下はBonferroniだけ、details内は補正なしとBonferroniの両方）
  const crit = result.pair.crit;
  const alphaBonf = Number(crit.alpha_bonf.toPrecision(3));
  document.getElementById('pair-ci-note').textContent = multi
    ? `※CIの臨界値: z = ${crit.z_bonf.toFixed(3)}（Bonferroni。ペア数 m = ${crit.m}、α/m = ${alphaBonf}）`
    : `※CIの臨界値: z = ${crit.z.toFixed(3)}（ペア数 m = 1 のため補正なし）`;
  document.getElementById('pair-ci-note-all').textContent =
    `※CIの臨界値: z = ${crit.z.toFixed(3)}（Unadjusted）、z = ${crit.z_bonf.toFixed(3)}（Bonferroni。ペア数 m = ${crit.m}、α/m = ${alphaBonf}）`;

  // 主グラフ（Bonferroni）と details 内のグラフ（補正なし + Bonferroni）は、要素idの接頭辞が違う（pair / pair-all）
  const tip = { items: result.pair.tooltips, level: result.pair.level, unit: ' points' };
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

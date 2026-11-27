// =====================================================================
// bayesian-props.html 用のJS。このページ専用の部分（サンプルデータ・サンプリング回数・結果の描画・ホバー表示・実行ボタンの処理）だけを書く。
// 入力欄・確認表・状態メッセージ・Pyodide・ツールチップは tool-common.js（ToolCommon）が担当。
//
// 【仕組み】
//  - 計算とグラフ描画は bayesian-props-py.js 内のPythonコード（BAYESIAN_PROPS_PY）がPyodide上で行う。
//    Pythonの run() は各グラフのSVG文字列をJSONで返し、ここで下記idのdivに挿入する。
//      #summary-chart / #summary-hdi / #summary-table-container（各群の表。Python が作る） / #estimation-note
//      #best-table（P(best)。HTML側の <details> の中。2群のときは #best-section ごと隠す）
//      #diff-hdi / #diff-table-container（各ペアの差と相対差の表。<details>の中） / #diff-chart
//  - これらのidは bayesian-props.html と page-common.css とHTMLの <style> に対応する。
//    id を変える時は html / css / このファイル（と py.js の戻り値のキー）を同時に直すこと。
//  - 確認表(#confirmation-table)は、HTML側に5行(Group A〜E)を固定で書いてあり、
//    ToolCommon が各セルの文字だけを更新する（行数が変わらないので、下のパーツがずれない）。
//  - 事後分布のホバー表示は、Pythonが返す hover データ（軸位置・ビン・密度）を使い、
//    ToolCommon のツールチップ（背景は群の色）をSVG上に出している。図の余白を変えるとズレるので注意。
//  - Pyodideはページ表示時に裏で読み込み開始（初回のみ数秒〜）。
//  - 結果欄は「全体結果」「群間の差」の2タブ（HTMLの .result-tabs）。切り替えは ToolCommon.createResultTabs() が担当し、
//    Clear のときは既定のタブ（全体結果）に戻す。
// =====================================================================

// 「サンプルデータ」ボタンで入るデータ
const SAMPLE = { denoms: "1000 2000 1500 1200 1600", numers: "70 120 95 110 150" };

ToolCommon.configurePyodide({
  packages: ['numpy', 'matplotlib'],
  sources: [TOOL_COMMON_PY, BAYESIAN_PROPS_PY],
});

// 結果を入れるdivのid（Clear で空にする）
const RESULT_IDS = ['summary-chart', 'summary-hdi', 'summary-table-container', 'estimation-note', 'best-table',
  'diff-hdi', 'diff-table-container', 'diff-chart'];

// 結果タブ。Clear のときは既定のタブに戻す
const resultTabs = ToolCommon.createResultTabs();

function clearResults() {
  ToolCommon.clearElements(RESULT_IDS);
  document.getElementById('best-section').hidden = true;
  if (resultTabs) resultTabs.reset();
}

const input = ToolCommon.createPropsInput({ sample: SAMPLE, onClear: clearResults });

/**
 * サンプリング回数のステッパー（10000〜50000、5000刻み）
 */
function setupSampleCountStepper() {
  const valueElement = document.getElementById("sample-count");
  const decrementButton = document.getElementById("sample-count-decrement");
  const incrementButton = document.getElementById("sample-count-increment");
  let value = 10000;

  const render = () => {
    valueElement.value = String(value);
    valueElement.textContent = String(value);
    decrementButton.disabled = value <= 10000;
    incrementButton.disabled = value >= 50000;
  };

  decrementButton.addEventListener("click", () => {
    value = Math.max(10000, value - 5000);
    render();
  });
  incrementButton.addEventListener("click", () => {
    value = Math.min(50000, value + 5000);
    render();
  });
  render();
}

setupSampleCountStepper();

/**
 * 事後分布グラフ上のホバー表示（SVGの上にツールチップを重ねる。背景は群の色）
 */
function attachPosteriorHover(container, hover) {
  const svg = container.querySelector('svg');
  const [ax0, ay0, ax1, ay1] = hover.axes;
  const [xmin, xmax] = hover.xlim;
  const [, ymax] = hover.ylim;
  const edges = hover.edges;

  svg.addEventListener('mouseleave', ToolCommon.hideTooltip);
  svg.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width;
    const fy = 1 - (ev.clientY - r.top) / r.height; // 下が0
    if (fx < ax0 || fx > ax1 || fy < ay0 || fy > ay1) return ToolCommon.hideTooltip();
    const x = xmin + (fx - ax0) / (ax1 - ax0) * (xmax - xmin);
    const y = (fy - ay0) / (ay1 - ay0) * ymax;

    let bin = -1;
    for (let b = 0; b < edges.length - 1; b++) {
      if (x >= edges[b] && x < edges[b + 1]) { bin = b; break; }
    }
    if (bin < 0) return ToolCommon.hideTooltip();

    // カーソル位置のy以上の高さを持つ群のうち、最前面（後に描画された群）を選ぶ
    let hit = -1;
    hover.densities.forEach((d, gi) => { if (d[bin] >= y) hit = gi; });
    if (hit < 0) return ToolCommon.hideTooltip();

    const g = hover.groups[hit];
    ToolCommon.showTooltip(ev, {
      html: `<b>Group ${g.id}</b><br>Mean: ${g.mean.toFixed(2)}%<br>94% HDI: [${g.lower.toFixed(2)} , ${g.upper.toFixed(2)}]`,
      color: g.color,
    });
  });
}

/**
 * Pythonの結果を画面に入れる
 */
function renderResults(result) {
  const posterior = document.getElementById('summary-chart');
  posterior.innerHTML = result.posterior;
  attachPosteriorHover(posterior, result.hover);

  document.getElementById('summary-hdi').innerHTML = result.hdis;
  document.getElementById('summary-table-container').innerHTML = result.table;
  document.getElementById('estimation-note').textContent =
    `※Mean, Std, HDI は、各群の事後分布から ${result.num_samples.toLocaleString()} 回サンプリングした値で計算しています（共役事後分布からの直接サンプリングでMCMCではないため、r_hat や ESS などの収束診断は不要です）。94%HDI はそのサンプルから求めた最短区間です。乱数の種は固定していないので、実行のたびに小数第2位あたりが少し変わることがあります。`;
  // P(best) は3群以上のときだけ（2群は null）
  document.getElementById('best-table').innerHTML = result.best_table || '';
  document.getElementById('best-section').hidden = !result.best_table;

  document.getElementById('diff-hdi').innerHTML = result.forest;
  document.getElementById('diff-table-container').innerHTML = result.diff_table;
  document.getElementById('diff-chart').innerHTML =
    result.diffs.map(svg => `<div class="diff-plot">${svg}</div>`).join('');
}

/**
 * 実行ボタン：Pyodideで計算・描画して画面に反映
 */
async function runBayesianEstimation() {
  const { denoms, numers, groupCount } = input.getData();
  if (groupCount < 2) {
    return ToolCommon.setStatus('error',
      '推定には少なくとも2群のデータが必要にゃん。手元にデータがなければ「Sample Data」ボタンで試してにゃん',
      { inputError: true });
  }
  const numSamples = parseInt(document.getElementById('sample-count').value);

  await ToolCommon.execute({
    input,
    runningText: `${groupCount}群でベイズ推定の実行中... 終わるまで待ってにゃん`,
    errorPrefix: '推定に失敗しました',
    work: async () => {
      const result = await ToolCommon.callPython('run',
        denoms.slice(0, groupCount), numers.slice(0, groupCount), numSamples);
      renderResults(result);
    },
  });
}

document.getElementById('run-button').addEventListener('click', runBayesianEstimation);

// 初回ロードに時間がかかるため、先に裏で読み込んでおく
ToolCommon.preloadPyodide();

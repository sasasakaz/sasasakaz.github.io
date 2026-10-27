// =====================================================================
// bayesian-props.html 用のJS。入力パース・確認テーブル・状態メッセージ・Pyodide呼び出しを担当。
//
// 【仕組み】
//  - 計算とグラフ描画は bayesian-props-py.js 内のPythonコード（BAYESIAN_PROPS_PY）がPyodide上で行う。
//    Pythonの run() は各グラフのSVG文字列をJSONで返し、ここで下記idのdivに挿入する。
//      #summary-chart / #summary-hdi / #diff-hdi / #diff-chart / #summary-table-container
//  - これらのidは bayesian-props.html と bayesian-props.css に対応する。
//    id を変える時は html / css / このファイルを同時に直すこと。
//  - 確認表(#confirmation-table)は、HTML側に5行(Group A〜E)を固定で書いてあり、
//    ここでは各セルの文字だけを更新する（行数が変わらないので、下のパーツがずれない）。
//  - 状態メッセージ: 初期は #initial-message、推定中は #running-message、推定完了は #completion-message、
//    失敗は #error-message を hidden で切り替える。
//  - 事後分布のホバー表示は、Pythonが返す hover データ（軸位置・ビン・密度）を使い、
//    SVG上に .plot-tooltip(css) を重ねて出している。図の余白を変えるとズレるので注意。
//  - Pyodideはページ表示時に裏で読み込み開始（初回のみ数秒〜）。
// =====================================================================

// --- [1] 設定・定数（ファイルの一番上にまとめる） ---
const MAX_GROUPS = 5;
// 数字(0, 1, 2...)をアルファベット(A, B, C...)に変換して配列を作る
const GROUP_IDS = Array.from({ length: MAX_GROUPS }, (_, i) => String.fromCharCode(65 + i));
const PERCENTAGE_FACTOR = 100;
const DEFAULT_HDI = 0.94;
const DEFAULT_HDI_50 = 0.5;

// 「サンプルデータ」ボタンで入るデータ
const SAMPLE_DENOMS = "1000 2000 1500 1200 1600";
const SAMPLE_NUMERS = "70 120 95 110 150";

// 推定中は true（実行ボタンを無効にしておくための印）
let isRunning = false;

/**
 * データの取得と整形
 */
function getInputData() {
  // 補助関数：全角数字を半角に変換
  const toHalfWidth = (str) => {
    return str
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, " "); // 全角スペースを半角に
  }

  const parseInput = (id) => {
    let raw = document.getElementById(id).value;
    raw = toHalfWidth(raw);

    // カンマ区切りなどの数値を処理
    // 「数字,数字」となっている箇所のカンマだけを、先に空文字に置換して消去する
    // これで Excelの 1,000 は 1000 になる。
    // ※ 1,000 2,000 の間の「, 」（カンマ+スペース）は、後ろのスペースが残る。
    const cleaned = raw.replace(/(\d),(?=\d)/g, '$1');

    return cleaned
      .replace(/,/g, " ")       // 残ったカンマ（区切り用）をスペースに
      .split(/\s+/)             // 改行・タブ・スペースで分割
      .filter(v => v !== "")    // 空っぽを除外
      .map(Number)              // 数値に変換
      .filter(v => !isNaN(v));  // 数字じゃない（NaN）ものを念のため弾く
  };

  const rawDenoms = parseInput('denoms');
  const rawNumers = parseInput('numers');

  // MAX_GROUPS を超えて入力されたか（超えた分は無視する。確認表の注記を赤くするために使う）
  const overflow = Math.max(rawDenoms.length, rawNumers.length) > MAX_GROUPS;
  const denoms = rawDenoms.slice(0, MAX_GROUPS);
  const numers = rawNumers.slice(0, MAX_GROUPS);

  const groupCount = Math.min(denoms.length, numers.length);
  return { denoms, numers, groupCount, overflow };
}

/**
 * 入力値のリアルタイムチェック（確認表の5行の文字を更新）
 */
function updateConfirmationTable() {
  const { denoms, numers, overflow } = getInputData();
  const rows = document.querySelectorAll('#confirmation-table tbody tr');
  const runButton = document.getElementById('run-button');

  // 分母・分子のどちらかでも入力のある行までを「入力あり」とする
  const rowCount = Math.max(denoms.length, numers.length);

  // エラーがあるかどうかを記録するフラグ
  let hasError = false;

  rows.forEach((tr, i) => {
    const cells = tr.querySelectorAll('td');   // 分母, 分子, 比率
    const d = denoms[i];
    const n = numers[i];
    const filled = i < rowCount;

    // 異常値の判定（片方しか入力がない、分子>分母、マイナス、分母0）
    const isInvalid = filled && (d === undefined || n === undefined || n > d || n < 0 || d <= 0);
    if (isInvalid) hasError = true;

    // 入力がない行は空欄、片方だけ入力がない場合は「—」
    const blank = filled ? '—' : '';
    cells[0].textContent = d === undefined ? blank : Math.round(d).toLocaleString();
    cells[1].textContent = n === undefined ? blank : Math.round(n).toLocaleString();

    const canCalc = d !== undefined && n !== undefined && d > 0;
    cells[2].textContent = canCalc
      ? (PERCENTAGE_FACTOR * n / d).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
      : blank;

    // 異常ならCSSクラスを付与
    tr.classList.toggle('invalid-cell', isInvalid);
    cells[2].classList.toggle('invalid-value', isInvalid);
  });

  // ★バリデーション結果をボタンに反映（見た目は CSS の :disabled で変わる）
  // 推定中・エラーがある・データが1件もない場合はボタンを押せなくする
  if (runButton) {
    runButton.disabled = isRunning || hasError || rowCount === 0;
  }
}

// --- Pyodide（計算・描画はbayesian-props.pyで実行） ---
const PYODIDE_VERSION = 'v0.27.7';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;
let pyodidePromise = null;

function loadPyodideRuntime() {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${PYODIDE_BASE}pyodide.js`;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Pyodideの読み込みに失敗しました'));
      document.head.appendChild(s);
    });
    const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
    await pyodide.loadPackage(['numpy', 'matplotlib']);
    pyodide.runPython(BAYESIAN_PROPS_PY);
    return pyodide;
  })().catch((e) => {
    pyodidePromise = null;
    throw e;
  });
  return pyodidePromise;
}

/**
 * 推定中はボタンを無効にする（ラベルは変えない。推定中の表示は #running-message が担当）
 */
function setRunButtonBusy(busy) {
  isRunning = busy;
  updateConfirmationTable();
}

// 次の描画が終わるまで待つ（Pythonの計算は画面を固めるので、その前に状態メッセージを描画させる）
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * 推定結果のサマリーテーブル
 */
function renderSummaryTable(rows) {
  const container = document.getElementById('summary-table-container');
  if (!container) return;
  const body = rows.map(s => `
            <tr>
                <td style="text-align: center;">Group ${s.id}</td>
                <td align="right">${s.mean.toFixed(2)}%</td>
                <td align="right">${s.lower.toFixed(2)}%</td>
                <td align="right">${s.upper.toFixed(2)}%</td>
            </tr>`).join('');
  container.innerHTML = `<table class="summary-table"><thead><tr><th>Group</th><th>Mean</th><th>HDI Lower</th><th>HDI Upper</th></tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * 事後分布グラフ上のホバー表示（SVGの上にツールチップを重ねる）
 */
function attachPosteriorHover(container, hover) {
  container.style.position = 'relative';
  let tip = container.querySelector('.plot-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'plot-tooltip';
    container.appendChild(tip);
  }
  const svg = container.querySelector('svg');
  const [ax0, ay0, ax1, ay1] = hover.axes;
  const [xmin, xmax] = hover.xlim;
  const [, ymax] = hover.ylim;
  const edges = hover.edges;
  const hide = () => { tip.style.display = 'none'; };

  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width;
    const fy = 1 - (ev.clientY - r.top) / r.height; // 下が0
    if (fx < ax0 || fx > ax1 || fy < ay0 || fy > ay1) return hide();
    const x = xmin + (fx - ax0) / (ax1 - ax0) * (xmax - xmin);
    const y = (fy - ay0) / (ay1 - ay0) * ymax;

    let bin = -1;
    for (let b = 0; b < edges.length - 1; b++) {
      if (x >= edges[b] && x < edges[b + 1]) { bin = b; break; }
    }
    if (bin < 0) return hide();

    // カーソル位置のy以上の高さを持つ群のうち、最前面（後に描画された群）を選ぶ
    let hit = -1;
    hover.densities.forEach((d, gi) => { if (d[bin] >= y) hit = gi; });
    if (hit < 0) return hide();

    const g = hover.groups[hit];
    tip.innerHTML = `<b>Group ${g.id}</b><br>Mean: ${g.mean.toFixed(2)}%<br>94% HDI: [${g.lower.toFixed(2)} , ${g.upper.toFixed(2)}]`;
    tip.style.background = g.color;
    const cr = container.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = `${ev.clientX - cr.left + 12}px`;
    tip.style.top = `${ev.clientY - cr.top + 12}px`;
  });
}

/**
 * メイン実行関数：Pyodideで計算・描画してDOMに反映
 */
async function runBayesianEstimation() {
  const { denoms, numers, groupCount } = getInputData();
  if (groupCount < 2) {
    return alert("推定には少なくとも2群のデータが必要にゃん。手元にデータがなければ「Sample Data」ボタンで試してにゃん");
  }

  const running = document.getElementById('running-message');
  const completion = document.getElementById('completion-message');

  const initial = document.getElementById('initial-message');
  const errorBox = document.getElementById('error-message');

  setRunButtonBusy(true);
  initial.hidden = true;
  errorBox.hidden = true;
  completion.hidden = true;
  document.getElementById('running-message-text').textContent =
    `${groupCount}群でベイズ推定の実行中... 終わるまで待ってにゃん`;
  running.hidden = false;

  try {
    const pyodide = await loadPyodideRuntime();
    await nextPaint();   // ここで状態メッセージを描画させてから、計算に入る
    const numSamples = parseInt(document.getElementById('sample-count').value);
    const runFn = pyodide.globals.get('run');
    const result = JSON.parse(runFn(
      denoms.slice(0, groupCount), numers.slice(0, groupCount), numSamples));
    runFn.destroy();

    const posterior = document.getElementById('summary-chart');
    posterior.innerHTML = result.posterior;
    attachPosteriorHover(posterior, result.hover);

    document.getElementById('summary-hdi').innerHTML = result.hdis;
    document.getElementById('diff-hdi').innerHTML = result.forest;
    document.getElementById('diff-chart').innerHTML =
      result.diffs.map(svg => `<div class="diff-plot">${svg}</div>`).join('');
    renderSummaryTable(result.table);

    completion.hidden = false;
  } catch (e) {
    console.error(e);
    errorBox.hidden = false;
  } finally {
    running.hidden = true;
    setRunButtonBusy(false);
  }
}

/**
 * 初期化処理
 */
window.addEventListener('DOMContentLoaded', () => {
  // 初期表示の確認表（入力は空欄なので、実行ボタンは無効のまま）
  updateConfirmationTable();

  // 初回ロードに時間がかかるため、先に裏で読み込んでおく
  loadPyodideRuntime().catch(console.error);

  const dArea = document.getElementById('denoms');
  const nArea = document.getElementById('numers');

  // テキストエリア（リアルタイムバリデーション）の監視
  dArea.addEventListener('input', updateConfirmationTable);
  nArea.addEventListener('input', updateConfirmationTable);

  // サンプルデータ：値を入れても input イベントは出ないので、確認表は自分で更新する
  document.getElementById('sample-button').addEventListener('click', () => {
    dArea.value = SAMPLE_DENOMS;
    nArea.value = SAMPLE_NUMERS;
    updateConfirmationTable();
  });

  // clear all：入力データだけを消す（表示中の推定結果は、再実行するまで残る）
  document.getElementById('clear-button').addEventListener('click', () => {
    dArea.value = '';
    nArea.value = '';
    updateConfirmationTable();
  });
});

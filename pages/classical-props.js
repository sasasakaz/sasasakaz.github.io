// =====================================================================
// classical-props.html 用のJS。入力パース・確認テーブル・状態メッセージ・Pyodide呼び出しを担当。
//
// 【仕組み】
//  - 計算とグラフ描画は classical-props-py.js 内のPythonコード（CLASSICAL_PROPS_PY）がPyodide上で行う。
//    Pythonの run() は表(HTML)とグラフ(SVG)をJSONで返し、ここで下記idのdivに挿入する。
//      #omni-summary / #omni-table / #omni-chart （全体の検定）
//      #pair-p-table / #pair-ci-table / #pair-chart （2群ごとの検定。#pair-p-table は常に表示、他は3群以上のみ）
//  - これらのidは classical-props.html と classical-props.css に対応する。
//    id を変える時は html / css / このファイルを同時に直すこと。
//  - 確認表(#confirmation-table)は、HTML側に5行(Group A〜E)を固定で書いてあり、
//    ここでは各セルの文字だけを更新する（行数が変わらないので、下のパーツがずれない）。
//  - 状態メッセージ: 初期は #initial-message、実行中は #running-message、完了は #completion-message、
//    失敗は #error-message を hidden で切り替える。
//  - Pyodideはページ表示時に裏で読み込み開始（初回のみ数秒〜）。
// =====================================================================

// --- [1] 設定・定数（ファイルの一番上にまとめる） ---
const MAX_GROUPS = 5;
const PERCENTAGE_FACTOR = 100;

// 「サンプルデータ」ボタンで入るデータ
const SAMPLE_DENOMS = "1000 2000 1500 1200 1600";
const SAMPLE_NUMERS = "70 120 95 110 150";

// 実行中は true（実行ボタンを無効にしておくための印）
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
    await pyodide.loadPackage(['numpy', 'scipy', 'matplotlib']);
    pyodide.runPython(CLASSICAL_PROPS_PY);
    return pyodide;
  })().catch((e) => {
    pyodidePromise = null;
    throw e;
  });
  return pyodidePromise;
}

/**
 * 実行中はボタンを無効にする（ラベルは変えない。推定中の表示は #running-message が担当）
 */
function setRunButtonBusy(busy) {
  isRunning = busy;
  updateConfirmationTable();
}

// 次の描画が終わるまで待つ（Pythonの計算は画面を固めるので、その前に状態メッセージを描画させる）
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

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

function addPairChartTooltips(chart, tooltips, level) {
  const svg = chart.querySelector('svg');
  if (!svg) {
    throw new Error('ペア比較グラフのSVGが見つかりません');
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'pair-chart-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  chart.appendChild(tooltip);

  const methods = {
    unadjusted: '補正なし',
    bonferroni: 'Bonferroni',
    tukey: 'Tukey'
  };
  const addTooltip = (id, text) => {
    const element = svg.querySelector(`[id="${id}"]`);
    if (!element) {
      throw new Error(`グラフ要素が見つかりません: ${id}`);
    }
    element.setAttribute('aria-label', text);

    const positionTooltip = (event) => {
      tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8)}px`;
      tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - tooltip.offsetHeight - 8)}px`;
    };
    element.addEventListener('pointerenter', (event) => {
      tooltip.textContent = text;
      tooltip.classList.add('visible');
      positionTooltip(event);
    });
    element.addEventListener('pointermove', positionTooltip);
    element.addEventListener('pointerleave', () => tooltip.classList.remove('visible'));
  };

  tooltips.forEach((item, row) => {
    Object.entries(methods).forEach(([method, label]) => {
      const interval = item.intervals[method];
      addTooltip(
        `pair-ci-${method}-${row}`,
        `${item.pair} / ${label} ${level}% CI: ${interval[0].toFixed(2)}〜${interval[1].toFixed(2)} points`
      );
      addTooltip(
        `pair-mean-${method}-${row}`,
        `${item.pair} / ${label} difference estimate: ${item.diff.toFixed(2)} points`
      );
    });
  });
}

/**
 * メイン実行関数：Pyodideで計算・描画してDOMに反映
 */
async function runClassicalTest() {
  const { denoms, numers, groupCount } = getInputData();
  if (groupCount < 2) {
    return alert("検定には少なくとも2群のデータが必要にゃん。手元にデータがなければ「Sample Data」ボタンで試してにゃん");
  }
  if (![...denoms, ...numers].every(Number.isInteger)) {
    return alert("Sample Size と Events は整数で入力してにゃん");
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
    `${groupCount}群で検定の実行中... 終わるまで待ってにゃん`;
  running.hidden = false;

  try {
    const pyodide = await loadPyodideRuntime();
    await nextPaint();   // ここで状態メッセージを描画させてから、計算に入る
    const alpha = parseFloat(document.getElementById('alpha-select').value);
    const runFn = pyodide.globals.get('run');
    const result = JSON.parse(runFn(
      denoms.slice(0, groupCount), numers.slice(0, groupCount), alpha));
    runFn.destroy();

    document.getElementById('omni-summary').innerHTML = renderOmniSummary(result.omni, alpha);
    document.getElementById('omni-table').innerHTML = result.omni.table;
    document.getElementById('omni-chart').innerHTML = result.omni.chart;

    // 2群のときは、説明とp値だけを表示し、区間の表・グラフは隠す
    const multi = groupCount >= 3;
    document.getElementById('pair-section').hidden = !multi;
    document.getElementById('pair-skipped').hidden = multi;
    document.getElementById('pair-p-table').innerHTML = result.pair.p_table;
    document.getElementById('pair-count').textContent = `${result.pair.pairs} ペア / 有意水準 ${alpha}`;
    if (multi) {
      document.getElementById('pair-ci-table').innerHTML = result.pair.ci_table;
      const pairChart = document.getElementById('pair-chart');
      pairChart.innerHTML = result.pair.chart;
      addPairChartTooltips(pairChart, result.pair.chart_tooltips, result.pair.level);
    }

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
    const hasInput = dArea.value.trim() !== '' || nArea.value.trim() !== '';
    if (hasInput && !window.confirm('入力データをサンプルデータで置き換えます。よろしいですか？')) {
      return;
    }

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

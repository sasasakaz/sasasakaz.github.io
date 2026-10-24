// =====================================================================
// beat_5g.html 用のJS。入力パース・確認テーブル・タブ切替・Pyodide呼び出しを担当。
//
// 【仕組み】
//  - 計算とグラフ描画は beat_5g_py.js 内のPythonコード（BEAT_5G_PY）がPyodide上で行う。
//    Pythonの run() は各グラフのSVG文字列をJSONで返し、ここで下記idのdivに挿入する。
//      #summary-chart / #summary-hdi / #diff-hdi / #diff-chart / #summary-table-container
//  - これらのid・タブ名（summary, diff）は beat_5g.html と beat_5g.css に対応する。
//    id を変える時は html / css / このファイルを同時に直すこと。
//  - 事後分布のホバー表示は、Pythonが返す hover データ（軸位置・ビン・密度）を使い、
//    SVG上に .plot-tooltip(css) を重ねて出している。図の余白を変えるとズレるので注意。
//  - Pyodideはページ表示時に裏で読み込み開始（初回のみ数秒〜）。
//  - plotly / jStat は使用しない。
// =====================================================================

// --- [1] 設定・定数（ファイルの一番上にまとめる） ---
const MAX_GROUPS = 5;
// 数字(0, 1, 2...)をアルファベット(A, B, C...)に変換して配列を作る
// String.fromCharCode(65) が "A" なのを利用するっす
const GROUP_IDS = Array.from({ length: MAX_GROUPS }, (_, i) => String.fromCharCode(65 + i));
const PERCENTAGE_FACTOR = 100;
const DEFAULT_HDI = 0.94;
const DEFAULT_HDI_50 = 0.5;

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
      .filter(v => !isNaN(v))   // 数字じゃない（NaN）ものを念のため弾く
      .slice(0, MAX_GROUPS);             // 最初のMAX_GROUPSだけ取る
  };

  const denoms = parseInput('denoms');
  const numers = parseInput('numers');

  const groupCount = Math.min(denoms.length, numers.length);
  return { denoms, numers, groupCount };
}

/**
 * 入力値のリアルタイムチェック（テーブルを動的に生成）
 */
function updateConfirmationTable() {
  const { denoms, numers, groupCount } = getInputData();
  const table = document.getElementById('confirmation-table');
  const runButton = document.getElementById('run-button');
  const groupIds = ['A', 'B', 'C', 'D', 'E'];


  if (!table) return;

  // テーブルの枠組みを作成
  let html = `<table class="confirmation-table">
                <thead>
                    <tr>
                        <th>Group</th>
                        <th>分母</th>
                        <th>分子</th>
                        <th>比率 (%)</th>
                    </tr>
                </thead>
                <tbody>`;

  // エラーがあるかどうかを記録するフラグ
  let hasError = false;

  for (let i = 0; i < groupCount; i++) {
    const d = denoms[i];
    const n = numers[i];

    // 異常値の判定（数字じゃない、分子>分母、マイナス、分母0）
    const isInvalid = isNaN(n) || isNaN(d) || (n > d) || (n < 0) || (d <= 0);

    // 一つでも異常があればエラーフラグを立てる
    if (isInvalid) {
      hasError = true;
    }

    const rateRaw = (d > 0) ? (PERCENTAGE_FACTOR * n / d) : 0;
    const rateDisplay = rateRaw.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    // 異常ならCSSクラスを付与
    const rowStyle = isInvalid ? 'class="invalid-cell"' : '';
    const textStyle = isInvalid ? 'class="invalid-value"' : '';

    html += `<tr ${rowStyle}>
                    <th style="text-align: center;">Group ${groupIds[i]}</th>
                    <td align="right">${Math.round(d).toLocaleString()}</td>
                    <td align="right">${Math.round(n).toLocaleString()}</td>
                    <td align="right" ${textStyle}>${rateDisplay}%</td>
                 </tr>`;
  }

  html += `</tbody></table>`;
  table.innerHTML = html;

  // ★バリデーション結果をボタンに反映
  if (runButton) {
    // エラーがある、またはデータが1件もない場合はボタンを押せなくする
    runButton.disabled = hasError || groupCount === 0;

    // 見た目も変える
    if (runButton.disabled) {
      runButton.style.opacity = "0.5";
      runButton.style.cursor = "not-allowed";
    } else {
      runButton.style.opacity = "1.0";
      runButton.style.cursor = "pointer";
    }
  }

}

/**
 * タブを切り替える関数
 */
function switchTab(tabName) {
  // 1. 全てのパネルから active クラスを外す
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  // 2. 選択されたパネルだけに active クラスをつける（CSSの.active { display: block; } が効く）
  const targetPanel = document.getElementById(`${tabName}-content`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // 3. ボタンの active クラス付け替え
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(button => {
    button.classList.remove('active');
  });

  // クリックされたボタンを特定して active にする
  const clickedButton = document.querySelector(`.tab-btn[onclick*="${tabName}"]`);
  if (clickedButton) {
    clickedButton.classList.add('active');
  }
}

// --- Pyodide（計算・描画はbeat_5g.pyで実行） ---
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
    pyodide.runPython(BEAT_5G_PY);
    return pyodide;
  })().catch((e) => {
    pyodidePromise = null;
    throw e;
  });
  return pyodidePromise;
}

function setRunButtonBusy(busy) {
  const btn = document.getElementById('run-button');
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.textContent = '計算中...';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    updateConfirmationTable();
  }
}

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
    return alert("推定には少なくとも2群のデータが必要にゃん。手元にデータがなければClear Allボタン押してサンプルデータで試してにゃん");
  }

  setRunButtonBusy(true);
  try {
    const pyodide = await loadPyodideRuntime();
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

    switchTab('summary');
    ['result-container', 'footer'].forEach(id => document.getElementById(id).style.display = 'block');
  } catch (e) {
    console.error(e);
    alert('計算に失敗しました: ' + e.message);
  } finally {
    setRunButtonBusy(false);
  }
}

/**
 * 初期化処理
 */
window.addEventListener('DOMContentLoaded', () => {
  // 初期表示のテーブル生成
  updateConfirmationTable();

  // 初回ロードに時間がかかるため、先に裏で読み込んでおく
  loadPyodideRuntime().catch(console.error);

  const dArea = document.getElementById('denoms');
  const nArea = document.getElementById('numers');
  // リセット対象のformを取得
  const inputForm = document.getElementById('input-form');

  // テキストエリア（リアルタイムバリデーション）の監視
  if (dArea && nArea) {
    dArea.addEventListener('input', updateConfirmationTable);
    nArea.addEventListener('input', updateConfirmationTable);
  }

  // リセットボタンの監視
  if (inputForm) {
    inputForm.addEventListener('reset', () => {
      // リセット直後に再計算と表示リセット
      setTimeout(updateConfirmationTable, 0);
      document.getElementById("result-container").style.display = "none";
      document.getElementById("footer").style.display = "none";
    });
  }
});
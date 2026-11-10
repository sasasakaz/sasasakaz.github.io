// =====================================================================
// tool-common.js — ツール系ページ共通のJS（classical-means / classical-props / bayesian-props / bayesian-means）
//
// 【役割】 画面まわりの共通処理。計算とグラフ描画はPython（tool-common-py.js と ページ別の *-py.js）が
//         Pyodide上で行い、このファイルは「入力 → 実行 → 結果の表示」の流れを支える。
//   1. Pyodide の読み込みと Python 関数の呼び出し（getPyodide / callPython）
//   2. 状態メッセージの切り替え（setStatus / showInputError / clearInputError / execute）
//   3. 数値入力のパース（parseNumbers）
//   4. 入力欄: props型（分母・分子の2欄）と means型（群ごとの入力欄）、確認表の更新、サンプル / Clear
//   5. グラフのツールチップ（showTooltip / hideTooltip / attachPairChartTooltips）
//
// 【使い方】 各ページのJSは、先頭で configurePyodide() を呼び、createPropsInput() か createMeansInput() で
//         入力欄をつくり、実行ボタンの処理で execute() に「結果を取って画面に入れる処理」を渡す。
//         ページごとに違うもの（サンプルデータ・結果の描画・実行ボタンの処理）は、各ページのJSに書く。
//         bayesian-means は Pyodide ではなく Cloud Run のAPIを fetch するので、1.（Pyodide）は使わない。
//
// 【読み込み順】 HTML で、tool-common-py.js → ページ別 *-py.js → 本ファイル → ページ別JS の順に defer で読む。
//
// 【HTML側の前提】 id は下記（どのページも同じ）。
//   #initial-message / #running-message(+#running-message-text) / #completion-message / #error-message(+#error-message-text)
//   #run-button / #sample-button / #clear-button / #confirmation-table（tbody に5行）
//   props型: #denoms / #numers    means型: #group-inputs（中に .sample-buttons）、確認表の各 tr に data-group="A〜E"
// =====================================================================
const ToolCommon = (() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /** 入力ミスなど、そのまま画面に出してよいエラー（throw すると、メッセージだけが表示される） */
  class UserError extends Error { }

  /** 実行中に Clear などで中止されたことを表す。execute() は、これを throw されたら何も表示せずに終わる（サーバー通信型のページ用） */
  class Cancelled extends Error { }

  const SAMPLE_CONFIRM_TEXT = '入力データをサンプルデータで置き換えます。よろしいですか？';

  // ===================================================================
  // 1. Pyodide
  // ===================================================================
  const PYODIDE_VERSION = 'v0.27.7';
  const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;
  let pyodideConfig = null;
  let pyodidePromise = null;

  /**
   * 読み込むPythonパッケージと、評価するPythonコードを登録する（ページのJSの先頭で1回呼ぶ）
   * @param {{packages: string[], sources: string[]}} config  sources は [TOOL_COMMON_PY, ページ別のPython] の順
   */
  function configurePyodide(config) {
    pyodideConfig = config;
  }

  function getPyodide() {
    if (pyodidePromise) return pyodidePromise;
    if (!pyodideConfig) return Promise.reject(new Error('configurePyodide() が呼ばれていません'));
    const { packages, sources } = pyodideConfig;
    pyodidePromise = (async () => {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${PYODIDE_BASE}pyodide.js`;
        s.onload = resolve;
        s.onerror = () => reject(new UserError('Pyodideの読み込みに失敗しました。ネットワーク環境などを確認してもう一度試してみてにゃん'));
        document.head.appendChild(s);
      });
      const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
      await pyodide.loadPackage(packages);
      sources.forEach((source) => pyodide.runPython(source));
      return pyodide;
    })().catch((e) => {
      pyodidePromise = null;
      throw e;
    });
    return pyodidePromise;
  }

  /** 初回ロードに時間がかかるため、ページ表示時に裏で読み込みを始めておく */
  function preloadPyodide() {
    getPyodide().catch(console.error);
  }

  /** 次の描画が終わるまで待つ（Pythonの計算は画面を固めるので、その前に状態メッセージを描画させる） */
  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  /**
   * Python の関数を呼んで、返ってきたJSON文字列をオブジェクトにして返す
   * （Pyodideの準備を待ち、状態メッセージを描画させてから計算に入る）
   */
  async function callPython(name, ...args) {
    const pyodide = await getPyodide();
    await nextPaint();
    const fn = pyodide.globals.get(name);
    try {
      return JSON.parse(fn(...args));
    } finally {
      fn.destroy();
    }
  }

  // ===================================================================
  // 2. 状態メッセージ
  // ===================================================================

  /**
   * 状態メッセージの表示を1つに切り替える
   * @param {'initial'|'running'|'completed'|'error'} state
   * @param {string} [text]  running / error のときの文言
   * @param {{inputError?: boolean}} [opts]  inputError: true なら、入力を直したときに自動で消える（入力由来のエラー扱い）
   */
  function setStatus(state, text = '', opts = {}) {
    $('initial-message').hidden = state !== 'initial';
    $('running-message').hidden = state !== 'running';
    $('completion-message').hidden = state !== 'completed';
    $('error-message').hidden = state !== 'error';
    $('running-message-text').textContent = state === 'running' ? text : '';
    $('error-message-text').textContent = state === 'error' ? text : '';
    delete $('error-message').dataset.inputError;
    if (state === 'error' && opts.inputError) $('error-message').dataset.inputError = 'true';
  }

  /** 入力欄の内容が不正なときのエラー表示（他の状態メッセージは触らない。入力が直ったら clearInputError で消える） */
  function showInputError(text) {
    $('error-message-text').textContent = text;
    $('error-message').dataset.inputError = 'true';
    $('error-message').hidden = false;
  }

  /** showInputError / setStatus(..., {inputError:true}) で出したエラーだけを消す（実行時エラーは消さない） */
  function clearInputError() {
    const box = $('error-message');
    if (!box.dataset.inputError) return;
    box.hidden = true;
    $('error-message-text').textContent = '';
    delete box.dataset.inputError;
  }

  /**
   * 実行の共通の流れ: 実行ボタンを無効 → 「実行中」表示 → work() → 「完了」表示。失敗時はエラー表示。
   * @param {object} p
   * @param {{setBusy: function(boolean)}} p.input  createPropsInput / createMeansInput の戻り値
   * @param {string} p.runningText  実行中に出す文言
   * @param {string} [p.errorPrefix]  想定外のエラーのとき、メッセージの前に付ける文言
   * @param {function(): Promise<void>} p.work  結果を取得して画面に入れる処理（入力の不備は UserError、中止は Cancelled を throw する）
   */
  async function execute({ input, runningText, errorPrefix = '実行に失敗しました', work }) {
    input.setBusy(true);
    setStatus('running', runningText);
    try {
      await work();
      setStatus('completed');
    } catch (e) {
      if (e instanceof Cancelled) return;   // 中止: 状態メッセージは Clear 側が初期状態に戻している
      console.error(e);
      setStatus('error', e instanceof UserError ? e.message : `${errorPrefix}: ${e.message}`);
    } finally {
      input.setBusy(false);
    }
  }

  /** 指定したidの要素の中身を空にする（結果欄のクリア用） */
  function clearElements(ids) {
    ids.forEach((id) => { const el = $(id); if (el) el.replaceChildren(); });
  }

  // ===================================================================
  // 3. 数値入力のパース
  // ===================================================================

  /** 全角の数字・記号を半角にする */
  function toHalfWidth(str) {
    return str
      .replace(/[０-９．，－＋]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/[−]/g, '-')   // U+2212 マイナス記号
      .replace(/　/g, ' ');   // 全角スペース
  }

  const NUMBER_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  // 桁区切りのカンマとみなすのは、3桁ずつの形に完全に一致するときだけ（1,000 / 12,345,678 / 12,345.67）
  const THOUSANDS_TOKEN = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;

  /**
   * テキストを数値の配列にする。区切りは、スペース・改行・タブ・カンマ・セミコロン・読点。
   * 空白などで区切った1かたまりが 1,000 や 12,345,678 のような桁区切りの形なら、カンマを消して1つの数値にする（Excelの表示対応）。
   * それ以外のカンマは区切りとして扱う（70, 120, 95 も 70,120,95 も 14.63,20.18 も3件に分かれる）。
   * ※ 70,120 のようにカンマの後がちょうど3桁だけのときは桁区切りと区別できず、70120 になる。区切りのカンマの後にはスペースを入れてもらう。
   * @returns {{values: number[], invalid: string[]}}  invalid: 数値として読めなかった部分（黙って捨てずに呼び出し側でエラーにする）
   */
  function parseNumbers(raw) {
    const values = [];
    const invalid = [];
    toHalfWidth(raw).split(/[\s;、]+/).forEach((chunk) => {
      const body = chunk.replace(/^,+|,+$/g, '');   // 「1,000, 2,000」の末尾カンマなど
      if (body === '') return;
      const tokens = THOUSANDS_TOKEN.test(body) ? [body.replace(/,/g, '')] : body.split(',').filter((x) => x !== '');
      tokens.forEach((token) => {
        if (NUMBER_TOKEN.test(token)) values.push(Number(token));
        else invalid.push(token);
      });
    });
    return { values, invalid };
  }

  /** エラー文に入れる、読めなかった部分の表示（長いときは短くする） */
  function quoteToken(token) {
    return `「${token.length > 12 ? `${token.slice(0, 12)}…` : token}」`;
  }

  // ===================================================================
  // 4. 入力欄（確認表・実行ボタンの有効/無効・サンプル・Clear）
  // ===================================================================

  /**
   * props型の入力欄: #denoms（分母）と #numers（分子）の2欄。確認表は5行×(分母, 分子, 比率)。
   * 入力の不備（数値でない・整数でない・分子>分母・片方だけ・6件以上）は、確認表の赤表示と入力エラーで知らせ、実行ボタンを無効にする。
   * @param {{sample: {denoms: string, numers: string}, maxGroups?: number, onClear?: function()}} p
   *        onClear: Clear ボタンで、結果欄を空にするためにページ側が渡す関数
   * @returns {{getData: function(), refresh: function(), setBusy: function(boolean)}}
   */
  function createPropsInput({ sample, maxGroups = 5, onClear = () => { } }) {
    const dArea = $('denoms');
    const nArea = $('numers');
    const runButton = $('run-button');
    const rows = document.querySelectorAll('#confirmation-table tbody tr');
    let busy = false;

    /** 入力欄から分母・分子を読み取る。error があれば入力に不備あり */
    function getData() {
      const d = parseNumbers(dArea.value);
      const n = parseNumbers(nArea.value);
      let error = null;
      if (d.invalid.length) {
        error = `Sample Size の入力に数値として解釈できない部分があります: ${quoteToken(d.invalid[0])}`;
      } else if (n.invalid.length) {
        error = `Events の入力に数値として解釈できない部分があります: ${quoteToken(n.invalid[0])}`;
      } else if (Math.max(d.values.length, n.values.length) > maxGroups) {
        error = `入力できるのは${maxGroups}群までです（${Math.max(d.values.length, n.values.length)}件入力されています）`;
      }
      const denoms = d.values.slice(0, maxGroups);
      const numers = n.values.slice(0, maxGroups);
      return { denoms, numers, groupCount: Math.min(denoms.length, numers.length), error };
    }

    /** 確認表の5行の文字を更新し、実行ボタンの有効/無効と入力エラー表示を反映する */
    function refresh() {
      const { denoms, numers, error } = getData();
      // 分母・分子のどちらかでも入力のある行までを「入力あり」とする
      const rowCount = Math.max(denoms.length, numers.length);
      let hasError = Boolean(error);

      rows.forEach((tr, i) => {
        const cells = tr.querySelectorAll('td');   // 分母, 分子, 比率
        if (error) {
          cells.forEach((cell) => { cell.textContent = ''; cell.classList.remove('invalid-value'); });
          tr.classList.remove('invalid-cell');
          return;
        }
        const d = denoms[i];
        const n = numers[i];
        const filled = i < rowCount;

        // 異常値の判定（片方しか入力がない、整数でない、分子>分母、マイナス、分母0）
        const isInvalid = filled && (d === undefined || n === undefined
          || !Number.isInteger(d) || !Number.isInteger(n) || n > d || n < 0 || d <= 0);
        if (isInvalid) hasError = true;

        // 入力がない行は空欄、片方だけ入力がない場合は「—」
        const blank = filled ? '—' : '';
        cells[0].textContent = d === undefined ? blank : d.toLocaleString();
        cells[1].textContent = n === undefined ? blank : n.toLocaleString();
        const canCalc = d !== undefined && n !== undefined && d > 0;
        cells[2].textContent = canCalc
          ? `${(100 * n / d).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
          : blank;

        // 異常ならCSSクラスを付与
        tr.classList.toggle('invalid-cell', isInvalid);
        cells[2].classList.toggle('invalid-value', isInvalid);
      });

      // 実行中・不備がある・データが1件もない場合は、実行ボタンを押せなくする
      runButton.disabled = busy || hasError || rowCount === 0;
      if (error) showInputError(error); else clearInputError();
    }

    function setBusy(value) {
      busy = value;
      refresh();
    }

    dArea.addEventListener('input', refresh);
    nArea.addEventListener('input', refresh);

    // サンプルデータ：値を入れても input イベントは出ないので、確認表は自分で更新する
    $('sample-button').addEventListener('click', () => {
      const hasInput = dArea.value.trim() !== '' || nArea.value.trim() !== '';
      if (hasInput && !window.confirm(SAMPLE_CONFIRM_TEXT)) return;
      dArea.value = sample.denoms;
      nArea.value = sample.numers;
      refresh();
    });

    // Clear：入力・結果・状態メッセージをすべて初期状態に戻す
    $('clear-button').addEventListener('click', () => {
      dArea.value = '';
      nArea.value = '';
      onClear();
      setStatus('initial');
      refresh();
    });

    refresh();
    return { getData, refresh, setBusy };
  }

  /**
   * means型の入力欄: 群ごとのテキストエリア（#group-A〜）を #group-inputs の中に作る。
   * 確認表は、各 tr の data-group に対応する行に N / Mean / Std / Min / Max を表示する。
   * 数値として読めない部分があるときは、入力エラーで知らせ、実行ボタンを無効にする。
   * 1群あたりの件数の上限は、HTML側の #group-inputs の data-max-values で指定する（省略時は上限なし）。
   * 超えた群は確認表の行を赤くし、入力エラーで知らせて、実行ボタンを無効にする。
   * エラー文の末尾に足す案内は data-over-limit-hint で指定できる（任意）。
   * @param {{groups: string[], sampleData: string[], placeholders?: string[], onClear?: function()}} p
   * @returns {{getData: function(), refresh: function(), setBusy: function(boolean)}}
   */
  function createMeansInput({ groups, sampleData, placeholders = [], onClear = () => { } }) {
    const container = $('group-inputs');
    const sampleButtons = container.querySelector('.sample-buttons');
    const runButton = $('run-button');
    const rows = document.querySelectorAll('#confirmation-table tbody tr');
    const maxValues = Number(container.dataset.maxValues) || Infinity;
    const overLimitHint = container.dataset.overLimitHint || '';
    let busy = false;

    const areaOf = (name) => $(`group-${name}`);
    const clearButtonOf = (name) => $(`clear-group-${name}`);
    const updateClearButton = (name) => { clearButtonOf(name).hidden = areaOf(name).value.trim() === ''; };

    groups.forEach((name, index) => {
      const group = document.createElement('div');
      group.className = `input-group group-${name.toLowerCase()}`;
      const header = document.createElement('div');
      header.className = 'input-group-header';
      const label = document.createElement('label');
      label.htmlFor = `group-${name}`;
      label.textContent = `Group ${name}`;
      const clearButton = document.createElement('button');
      clearButton.id = `clear-group-${name}`;
      clearButton.className = 'input-clear-button';
      clearButton.type = 'button';
      clearButton.textContent = '×';
      clearButton.setAttribute('aria-label', `Group ${name} のデータをクリア`);
      clearButton.hidden = true;
      const textarea = document.createElement('textarea');
      textarea.id = `group-${name}`;
      textarea.name = `group-${name}`;
      textarea.placeholder = placeholders[index] ?? '';
      textarea.setAttribute('aria-label', `Group ${name} のデータ`);
      textarea.addEventListener('input', () => {
        updateClearButton(name);
        refresh();
      });
      clearButton.addEventListener('click', () => {
        textarea.value = '';
        updateClearButton(name);
        refresh();
        textarea.focus();
      });
      header.append(label, clearButton);
      group.append(header, textarea);
      container.appendChild(group);
    });
    container.appendChild(sampleButtons);   // サンプル/Clear ボタンを、群の入力欄の後ろ（グリッドの最後）に移す

    /** 入力のある群だけを [[名前, 数値の配列], ...] にする。読めない部分・件数超過があれば error（overLimit: 超過した群名） */
    function getData() {
      const parsed = [];
      const overLimit = [];
      for (const name of groups) {
        const { values, invalid } = parseNumbers(areaOf(name).value);
        if (invalid.length) {
          return {
            groups: [], groupCount: 0, overLimit: [],
            error: `Group ${name} の入力に数値として解釈できない部分があります: ${quoteToken(invalid[0])}`,
          };
        }
        if (values.length > 0) parsed.push([name, values]);
        if (values.length > maxValues) overLimit.push([name, values.length]);
      }
      let error = null;
      if (overLimit.length) {
        const [name, count] = overLimit[0];
        error = `Group ${name} の入力は${maxValues.toLocaleString()}件までです（${count.toLocaleString()}件入力されています）。${overLimitHint}`;
      }
      return { groups: parsed, groupCount: parsed.length, overLimit: overLimit.map(([name]) => name), error };
    }

    function describe(values) {
      const count = values.length;
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const v of values) {
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const mean = sum / count;
      let sumSq = 0;
      for (const v of values) sumSq += (v - mean) ** 2;
      return { count, mean, std: count > 1 ? Math.sqrt(sumSq / (count - 1)) : NaN, min, max };
    }

    function refresh() {
      const { groups: parsed, groupCount, overLimit, error } = getData();
      const statsByGroup = new Map(parsed.map(([name, values]) => [name, describe(values)]));
      rows.forEach((tr) => {
        const s = statsByGroup.get(tr.dataset.group);
        const texts = s
          ? [s.count.toLocaleString(), s.mean.toFixed(2), Number.isFinite(s.std) ? s.std.toFixed(2) : '', s.min.toFixed(2), s.max.toFixed(2)]
          : ['', '', '', '', ''];
        const cells = tr.querySelectorAll('td');
        cells.forEach((cell, i) => { cell.textContent = texts[i]; });
        // 件数が上限を超えた群は、行を赤くして N を強調する
        const isOver = overLimit.includes(tr.dataset.group);
        tr.classList.toggle('invalid-cell', isOver);
        cells[0].classList.toggle('invalid-value', isOver);
      });
      runButton.disabled = busy || Boolean(error) || groupCount === 0;
      if (error) showInputError(error); else clearInputError();
    }

    function setBusy(value) {
      busy = value;
      refresh();
    }

    $('sample-button').addEventListener('click', () => {
      const hasInput = groups.some((name) => areaOf(name).value.trim() !== '');
      if (hasInput && !window.confirm(SAMPLE_CONFIRM_TEXT)) return;
      groups.forEach((name, index) => {
        areaOf(name).value = sampleData[index] ?? '';
        updateClearButton(name);
      });
      refresh();
    });

    // Clear：入力・結果・状態メッセージをすべて初期状態に戻す
    $('clear-button').addEventListener('click', () => {
      groups.forEach((name) => {
        areaOf(name).value = '';
        updateClearButton(name);
      });
      onClear();
      setStatus('initial');
      refresh();
    });

    refresh();
    return { getData, refresh, setBusy };
  }

  // ===================================================================
  // 5. グラフのツールチップ（見た目は page-common.css の .chart-tooltip）
  // ===================================================================
  let tooltipEl = null;

  function getTooltipElement() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'chart-tooltip';
      tooltipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  /** ツールチップをマウス位置の近くに出す。html を渡すとHTMLとして、text なら文字として表示。color は背景色 */
  function showTooltip(event, { text, html, color }) {
    const el = getTooltipElement();
    if (html !== undefined) el.innerHTML = html; else el.textContent = text;
    el.style.background = color || '';
    el.classList.add('visible');
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const el = getTooltipElement();
    el.style.left = `${Math.max(4, Math.min(event.clientX + 12, window.innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(4, Math.min(event.clientY + 12, window.innerHeight - el.offsetHeight - 8))}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove('visible');
  }

  /** 差の信頼区間グラフの手法ごとの名前と色（色は classical-*-py.js の specs と同じにしておく） */
  const PAIR_METHODS = {
    unadjusted: { label: 'Unadjusted', color: '#1f77b4' },
    bonferroni: { label: 'Bonferroni', color: '#2ca02c' },
    tukey: { label: 'Tukey', color: '#ff7f0e' },
  };

  /**
   * 差の信頼区間グラフの線・丸印に、マウスオン時の値表示を付ける。
   * 要素のidは Python の set_gid と対応: {prefix}-ci-{method}-{行} / {prefix}-mean-{method}-{行}
   * @param {HTMLElement} chart  SVGを入れた要素
   * @param {{prefix: string, items: object[], level: number, unit?: string}} p  items は Python の tooltips
   */
  function attachPairChartTooltips(chart, { prefix, items, level, unit = '' }) {
    const svg = chart.querySelector('svg');
    if (!svg) throw new Error('ペア比較グラフのSVGが見つかりません');

    const attach = (id, text, color) => {
      const element = svg.querySelector(`[id="${id}"]`);
      if (!element) return;
      element.setAttribute('aria-label', text);
      element.addEventListener('pointerenter', (event) => showTooltip(event, { text, color }));
      element.addEventListener('pointermove', moveTooltip);
      element.addEventListener('pointerleave', hideTooltip);
    };

    items.forEach((item, row) => {
      Object.entries(PAIR_METHODS).forEach(([method, { label, color }]) => {
        const interval = item.intervals[method];
        if (!interval) return;   // 2群のときは、補正なしの区間だけ
        attach(`${prefix}-ci-${method}-${row}`,
          `${item.pair} / ${label} ${level}% CI: ${interval[0].toFixed(2)}〜${interval[1].toFixed(2)}${unit}`, color);
        attach(`${prefix}-mean-${method}-${row}`,
          `${item.pair} / ${label} difference estimate: ${item.diff.toFixed(2)}${unit}`, color);
      });
    });
  }

  return {
    UserError, Cancelled,
    configurePyodide, getPyodide, preloadPyodide, callPython, nextPaint,
    setStatus, showInputError, clearInputError, execute, clearElements,
    parseNumbers,
    createPropsInput, createMeansInput,
    showTooltip, moveTooltip, hideTooltip, attachPairChartTooltips,
  };
})();

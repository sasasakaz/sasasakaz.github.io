// =====================================================================
// classical-means のPythonコード（Pyodide上で実行）を、JS文字列 CLASSICAL_MEANS_PY として保持するファイル。
//
// 【仕組み】
//  - classical-means.html が本ファイルを classical-means.js より先に <script> で読み込む。
//  - classical-means.js の loadPyodideRuntime() が Pyodide(CDN)と numpy/scipy/matplotlib を読み込み、
//    pyodide.runPython(CLASSICAL_MEANS_PY) で下のコードを評価する。
//  - 実行ボタンで classical-means.js が Python の run(ids, groups, alpha) を呼ぶと、
//    表(HTML文字列)とグラフ(SVG文字列)を含むJSONが返り、JSが各idのdivに innerHTML で挿入する。
//      group_table/group_chart -> #group-table/#group-chart
//      omni（3群以上のみ。2群は null）-> #omni-summary（JSが文章化）
//      pair_table/pair_chart   -> #pair-t-table/#pair-chart
//      adj_table（3群以上のみ。2群は null）-> #pair-adj-table
//  - 入力が不正なときは {"error": "..."} を返す。
//
// 【編集時の注意】
//  - file:// でも動くよう fetch せず文字列で埋め込んでいる。バッククォート(\`)と
//    \${ は文字列を壊すので、Pythonコード内に書かないこと（f-stringの {} 単体は可）。
//  - run() の戻り値のキーを変えたら classical-means.js 側も合わせて直すこと。
//  - 純粋なPythonは先頭/末尾のバッククォート行の間だけ。インデントはPythonの文法そのもの。
//  - scipy だけで完結させている（Welch検定・多重比較補正は自前実装。statsmodels/pandas不要）。
//  - 計算は best_5g.ipynb の「welch t検定」セクションに対応している。
// =====================================================================
const CLASSICAL_MEANS_PY = String.raw`
"""classical-means: 平均の古典的検定の計算とmatplotlibによる描画（Pyodide上で実行）"""
import io
import itertools
import json

import matplotlib

matplotlib.use("agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats as sps

DPI = 100
COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#7f7f7f", "#9467bd"]
PLOT_BG = "white"
ORANGE = "#ff8c00"
SIG_BG = "#fff3a3"

plt.rcParams["svg.fonttype"] = "none"  # 文字をテキストのまま出力（選択可能・軽量）


def style_axes(ax, grid_x=False, grid_color="#e5e5e5", grid_width=0.8):
    ax.set_facecolor(PLOT_BG)
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.tick_params(length=0)
    ax.set_axisbelow(True)
    ax.grid(False)
    if grid_x:
        ax.xaxis.grid(True, color=grid_color, linewidth=grid_width)


def to_svg(fig):
    buf = io.StringIO()
    fig.savefig(buf, format="svg")
    plt.close(fig)
    svg = buf.getvalue()
    return svg[svg.index("<svg"):]


def new_fig(w_px, h_px):
    return plt.subplots(figsize=(w_px / DPI, h_px / DPI), dpi=DPI)


def p_bonferroni(p):
    return np.minimum(p * len(p), 1.0)


def p_holm(p):
    m = len(p)
    order = np.argsort(p)
    adj = np.maximum.accumulate((m - np.arange(m)) * p[order])
    out = np.empty(m)
    out[order] = np.minimum(adj, 1.0)
    return out


def p_bh(p):
    m = len(p)
    order = np.argsort(p)
    adj = np.minimum.accumulate((m / (np.arange(m) + 1) * p[order])[::-1])[::-1]
    out = np.empty(m)
    out[order] = np.minimum(adj, 1.0)
    return out


def html_table(headers, kinds, rows, alpha=0.05):
    """kinds は列ごとの種別: text / int / f2 / p（p は alpha 未満を黄色にして小数4桁で表示）"""
    head = "".join(f"<th>{h}</th>" for h in headers)
    body = []
    for row in rows:
        cells = []
        for kind, v in zip(kinds, row):
            if kind == "text":
                cells.append(f"<td>{v}</td>")
            elif kind == "int":
                cells.append(f"<td>{int(v):,}</td>")
            elif kind == "p":
                style = f' style="background-color: {SIG_BG};"' if v < alpha else ""
                cells.append(f"<td{style}>{v:.4f}</td>")
            else:
                cells.append(f"<td>{v:.2f}</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return (f'<table class="summary-table"><thead><tr>{head}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table>')


def group_summary(ids, xs, alpha, level):
    k = len(xs)
    n = np.array([len(x) for x in xs])
    mean = np.array([np.mean(x) for x in xs])
    sd = np.array([np.std(x, ddof=1) for x in xs])
    half = sps.t.ppf(1 - alpha / 2, n - 1) * sd / np.sqrt(n)

    rows = [[f"Group {ids[i]}", n[i], mean[i], sd[i], mean[i] - half[i], mean[i] + half[i]] for i in range(k)]
    table = html_table(
        ["Group", "N", "Mean", "SD", f"{level}%CI Lower", f"{level}%CI Upper"],
        ["text", "int", "f2", "f2", "f2", "f2"], rows)

    fig, ax = new_fig(640, 50 * k + 120)
    style_axes(ax, grid_x=True)
    for i in range(k):
        c = COLORS[i % len(COLORS)]
        ax.hlines(i, mean[i] - half[i], mean[i] + half[i], color=c, linewidth=2.5)
        ax.plot([mean[i]], [i], "o", markersize=6, markerfacecolor="white", markeredgecolor=c)
    ax.set_yticks(range(k))
    ax.set_yticklabels([f"Group {g}" for g in ids])
    ax.invert_yaxis()
    ax.set_xlabel("Average")
    ax.set_title(f"Average with {level}% CI")
    fig.tight_layout()
    return n, mean, sd, table, to_svg(fig)


def welch_anova(n, mean, sd, alpha):
    k = len(n)
    var = sd ** 2
    w = n / var
    mean_w = np.sum(w * mean) / np.sum(w)
    numer = np.sum(w * (mean - mean_w) ** 2) / (k - 1)
    lam = np.sum((1 - w / np.sum(w)) ** 2 / (n - 1))
    f_welch = numer / (1 + 2 * (k - 2) / (k ** 2 - 1) * lam)
    df1 = k - 1
    df2 = (k ** 2 - 1) / (3 * lam)
    p = float(sps.f.sf(f_welch, df1, df2))
    return {"f": float(f_welch), "df1": int(df1), "df2": float(df2), "p": p, "significant": bool(p < alpha)}


def pairwise(ids, n, mean, sd, alpha, level):
    k = len(n)
    var = sd ** 2
    pairs = list(itertools.combinations(range(k), 2))
    m = len(pairs)
    rows = []
    for i, j in pairs:
        diff = mean[j] - mean[i]  # 差分は「後の群 − 前の群」
        se_i = var[i] / n[i]
        se_j = var[j] / n[j]
        se = np.sqrt(se_i + se_j)
        t_stat = diff / se
        dof = (se_i + se_j) ** 2 / (se_i ** 2 / (n[i] - 1) + se_j ** 2 / (n[j] - 1))  # Welch-Satterthwaite
        p_val = float(sps.t.sf(abs(t_stat), dof) * 2)
        t_crit = sps.t.ppf(1 - alpha / 2, dof)
        rows.append({"pair": f"{ids[j]} - {ids[i]}", "diff": float(diff), "se": float(se), "t": float(t_stat),
                     "dof": float(dof), "p": p_val, "lo": float(diff - t_crit * se), "hi": float(diff + t_crit * se)})

    t_rows = [[r["pair"], r["diff"], r["se"], r["t"], r["dof"], r["p"], r["lo"], r["hi"]] for r in rows]
    t_table = html_table(
        ["Pair", "diff", "SE", "t", "dof", "p", f"{level}%CI Lower", f"{level}%CI Upper"],
        ["text", "f2", "f2", "f2", "f2", "p", "f2", "f2"], t_rows, alpha)

    fig, ax = new_fig(640, 45 * m + 120)
    style_axes(ax, grid_x=True)
    for r, row in enumerate(rows):
        ax.hlines(r, row["lo"], row["hi"], color="#1f77b4", linewidth=2.5)
    ax.plot([r["diff"] for r in rows], np.arange(m), "o", markersize=5,
            markerfacecolor="white", markeredgecolor="#1f77b4")
    ax.axvline(0, color=ORANGE, linewidth=2, zorder=0)
    ax.set_yticks(range(m))
    ax.set_yticklabels([r["pair"] for r in rows])
    ax.invert_yaxis()
    ax.set_xlabel("Difference in average (later group - earlier group)")
    ax.set_title(f"Pairwise differences: {level}% CI (Welch t-test, uncorrected)")
    fig.tight_layout()

    adj_table = None
    if k >= 3:
        p_raw = np.array([r["p"] for r in rows])
        p_bonf, p_hol, p_bhh = p_bonferroni(p_raw), p_holm(p_raw), p_bh(p_raw)
        adj_rows = [[r["pair"], r["diff"], r["p"], p_bonf[x], p_hol[x], p_bhh[x]] for x, r in enumerate(rows)]
        adj_table = html_table(
            ["Pair", "diff", "p (補正なし)", "p (Bonferroni)", "p (Holm)", "p (BH)"],
            ["text", "f2", "p", "p", "p", "p"], adj_rows, alpha)
    return t_table, to_svg(fig), adj_table


def run(ids, groups, alpha):
    try:
        ids = list(ids)
        xs = [np.array([float(v) for v in g]) for g in groups]
        alpha = float(alpha)
        k = len(xs)
        if not 2 <= k <= 5:
            raise ValueError("2〜5群のデータを入力してください")
        if any(len(x) < 2 for x in xs):
            raise ValueError("各群2件以上のデータが必要です")
        if any(np.std(x, ddof=1) == 0 for x in xs):
            raise ValueError("標準偏差が0の群があるため検定できません（全て同じ値の群があります）")
        level = int(round((1 - alpha) * 100))

        n, mean, sd, group_table, group_chart = group_summary(ids, xs, alpha, level)
        omni = welch_anova(n, mean, sd, alpha) if k >= 3 else None
        pair_table, pair_chart, adj_table = pairwise(ids, n, mean, sd, alpha, level)
        return json.dumps({
            "alpha": alpha, "level": level,
            "group_table": group_table, "group_chart": group_chart,
            "omni": omni,
            "pair_table": pair_table, "pair_chart": pair_chart,
            "adj_table": adj_table,
        })
    except ValueError as e:
        return json.dumps({"error": str(e)})
`;

// =====================================================================
// classical-props のPythonコード（Pyodide上で実行）を、JS文字列 CLASSICAL_PROPS_PY として保持するファイル。
//
// 【仕組み】
//  - classical-props.html が本ファイルを classical-props.js より先に <script> で読み込む。
//  - classical-props.js の loadPyodideRuntime() が Pyodide(CDN)と numpy/scipy/matplotlib を読み込み、
//    pyodide.runPython(CLASSICAL_PROPS_PY) で下のコードを評価する。
//  - 実行ボタンで classical-props.js が Python の run(denoms, numers, alpha) を呼ぶと、
//    表(HTML文字列)とグラフ(SVG文字列)を含むJSONが返り、JSが各idのdivに innerHTML で挿入する。
//      omni -> #omni-summary / omni_table -> #omni-table / omni_chart -> #omni-chart
//      pair -> #pair-p-table / #pair-ci-table / #pair-chart（後2つは3群以上のみ表示）
//  - 図の表示サイズは classical-props.css（各idのwidthと svg{width:100%}）で決まり、
//    ここの figsize(px指定) は縦横比と文字の相対サイズを決める。
//
// 【編集時の注意】
//  - file:// でも動くよう fetch せず文字列で埋め込んでいる。バッククォート(\`)と
//    \${ は文字列を壊すので、Pythonコード内に書かないこと（f-stringの {} 単体は可）。
//  - run() の戻り値のキーを変えたら classical-props.js 側も合わせて直すこと。
//  - 純粋なPythonは先頭/末尾のバッククォート行の間だけ。インデントはPythonの文法そのもの。
//  - scipy だけで完結させている（Wilson区間・多重比較補正は自前実装。statsmodels/pandas不要）。
// =====================================================================
const CLASSICAL_PROPS_PY = String.raw`
"""classical-props: 古典的検定の計算とmatplotlibによる描画（Pyodide上で実行）"""
import io
import json

import matplotlib

matplotlib.use("agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats as sps

DPI = 100
COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#7f7f7f", "#9467bd"]
PLOT_BG = "white"
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


def wilson(n, d, alpha):
    """Wilson区間（0〜1）"""
    z = sps.norm.ppf(1 - alpha / 2)
    p = n / d
    denom = 1 + z * z / d
    center = (p + z * z / (2 * d)) / denom
    half = z * np.sqrt(p * (1 - p) / d + z * z / (4 * d * d)) / denom
    return center - half, center + half


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


def html_table(headers, rows, highlight_cols=(), alpha=0.05):
    """rows は文字列/数値のリスト。highlight_cols の列は p値 < alpha を黄色にする"""
    head = "".join(f"<th>{h}</th>" for h in headers)
    body = []
    for row in rows:
        cells = []
        for j, v in enumerate(row):
            if j == 0:
                cells.append(f'<td style="text-align: center;">{v}</td>')
            elif j in highlight_cols:
                style = f' style="background-color: {SIG_BG};"' if v < alpha else ""
                cells.append(f"<td{style}>{v:.4f}</td>")
            else:
                cells.append(f"<td>{v:.2f}</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return (f'<table class="summary-table"><thead><tr>{head}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table>')


def omnibus(denoms, numers, ids, alpha, level):
    k = len(denoms)
    n_total = int(sum(denoms))
    table = np.array([numers, [d - n for d, n in zip(denoms, numers)]])
    chi2, p_omni, dof, expected = sps.chi2_contingency(table, correction=False)
    cramers_v = float(np.sqrt(chi2 / n_total))

    p_hat = np.array(numers) / np.array(denoms)
    lo, hi = wilson(np.array(numers, dtype=float), np.array(denoms, dtype=float), alpha)
    rows = [[f"Group {ids[i]}", 100 * p_hat[i], 100 * lo[i], 100 * hi[i]] for i in range(k)]
    ci_table = html_table(
        ["Group", "Rate (%)", f"{level}%CI Lower (%)", f"{level}%CI Upper (%)"], rows)

    fig, ax = new_fig(640, 50 * k + 120)
    style_axes(ax, grid_x=True)
    for i in range(k):
        c = COLORS[i % len(COLORS)]
        ax.hlines(i, 100 * lo[i], 100 * hi[i], color=c, linewidth=2.5)
        ax.plot([100 * p_hat[i]], [i], "o", markersize=6, markerfacecolor="white", markeredgecolor=c)
    ax.set_yticks(range(k))
    ax.set_yticklabels([f"Group {g}" for g in ids])
    ax.invert_yaxis()
    ax.set_xlabel("Rate (%)")
    ax.set_title(f"Rate with {level}% CI (Wilson)")
    fig.tight_layout()

    return {
        "chi2": float(chi2), "df": int(dof), "p": float(p_omni), "v": cramers_v,
        "significant": bool(p_omni < alpha),
        "low_expected": bool(expected.min() < 5),
        "table": ci_table,
        "chart": to_svg(fig),
    }, p_hat, n_total


def pairwise(denoms, numers, ids, alpha, level, p_hat, n_total):
    k = len(denoms)
    pairs = [(i, j) for i in range(k) for j in range(i + 1, k)]
    m = len(pairs)
    dens = np.array(denoms, dtype=float)

    # Tukey-Kramer用: 0/1データの群内分散（プール）
    df_err = n_total - k
    mse = float(np.sum(dens * p_hat * (1 - p_hat)) / df_err)
    q_crit = sps.studentized_range.ppf(1 - alpha, k, df_err)
    z_unadj = sps.norm.ppf(1 - alpha / 2)
    z_bonf = sps.norm.ppf(1 - alpha / (2 * m))

    rows = []
    for i, j in pairs:
        d = p_hat[i] - p_hat[j]
        se = np.sqrt(p_hat[i] * (1 - p_hat[i]) / dens[i] + p_hat[j] * (1 - p_hat[j]) / dens[j])
        tbl = [[numers[i], denoms[i] - numers[i]], [numers[j], denoms[j] - numers[j]]]
        try:
            p_raw = sps.chi2_contingency(tbl, correction=False)[1]
        except ValueError:  # 期待度数0（両群とも0%/100%など）
            p_raw = 1.0
        se_t = np.sqrt(mse / 2 * (1 / dens[i] + 1 / dens[j]))
        rows.append({
            "pair": f"{ids[i]} - {ids[j]}", "diff": 100 * d,
            "lo": 100 * (d - z_unadj * se), "hi": 100 * (d + z_unadj * se),
            "blo": 100 * (d - z_bonf * se), "bhi": 100 * (d + z_bonf * se),
            "tlo": 100 * (d - q_crit * se_t), "thi": 100 * (d + q_crit * se_t),
            "p_raw": float(p_raw),
            "p_tukey": float(sps.studentized_range.sf(abs(d) / se_t, k, df_err)),
        })
    p_raw_all = np.array([r["p_raw"] for r in rows])
    p_bonf, p_hol, p_bhh = p_bonferroni(p_raw_all), p_holm(p_raw_all), p_bh(p_raw_all)

    p_rows = [[r["pair"], r["diff"], r["lo"], r["hi"], r["p_raw"], p_bonf[n], p_hol[n], p_bhh[n], r["p_tukey"]]
              for n, r in enumerate(rows)]
    p_table = html_table(
        ["Pair", "diff (points)", "CI Lower", "CI Upper", "p (補正なし)", "p (Bonferroni)", "p (Holm)", "p (BH)", "p (Tukey)"],
        p_rows, highlight_cols=(4, 5, 6, 7, 8), alpha=alpha)
    ci_rows = [[r["pair"], r["diff"], r["lo"], r["hi"], r["blo"], r["bhi"], r["tlo"], r["thi"]] for r in rows]
    ci_table = html_table(
        ["Pair", "diff (points)", "CI Lower", "CI Upper", "Bonf CI Lower", "Bonf CI Upper", "Tukey CI Lower", "Tukey CI Upper"],
        ci_rows)

    # 差のCI比較（補正なし vs Bonferroni vs Tukey）
    fig, ax = new_fig(640, 55 * m + 150)
    style_axes(ax)
    specs = [("lo", "hi", "補正なし", "unadjusted", "#1f77b4", -0.3),
             ("blo", "bhi", "Bonferroni", "bonferroni", "#2ca02c", 0.0),
             ("tlo", "thi", "Tukey", "tukey", "#ff7f0e", 0.3)]
    for lo_c, hi_c, label, method, c, off in specs:
        for r, row in enumerate(rows):
            interval = ax.hlines(r + off, row[lo_c], row[hi_c], color=c, linewidth=3.5,
                                 label=label if r == 0 else None)
            interval.set_gid(f"pair-ci-{method}-{r}")
            mean = ax.plot([row["diff"]], [r + off], "o", markersize=5,
                           markerfacecolor="white", markeredgecolor="black")[0]
            mean.set_gid(f"pair-mean-{method}-{r}")
    ax.axvline(0, color="gray", linestyle="--", linewidth=1.5, zorder=0)
    ax.set_yticks(range(m))
    ax.set_yticklabels([r["pair"] for r in rows])
    ax.invert_yaxis()
    ax.set_xlabel("Difference in rate (points)")
    ax.set_title(f"Pairwise differences: {level}% CI", pad=24)
    ax.legend(frameon=False, fontsize=8, loc="lower center", bbox_to_anchor=(0.5, 1.02),
              ncol=3, borderaxespad=0)
    fig.tight_layout()

    chart_tooltips = [{
        "pair": row["pair"],
        "diff": row["diff"],
        "intervals": {
            "unadjusted": [row["lo"], row["hi"]],
            "bonferroni": [row["blo"], row["bhi"]],
            "tukey": [row["tlo"], row["thi"]],
        },
    } for row in rows]
    return {
        "pairs": m, "level": level, "p_table": p_table, "ci_table": ci_table,
        "chart": to_svg(fig), "chart_tooltips": chart_tooltips,
    }


def run(denoms, numers, alpha):
    denoms = [int(x) for x in denoms]
    numers = [int(x) for x in numers]
    alpha = float(alpha)
    k = len(denoms)
    ids = [chr(65 + i) for i in range(k)]
    level = int(round((1 - alpha) * 100))

    omni, p_hat, n_total = omnibus(denoms, numers, ids, alpha, level)
    pair = pairwise(denoms, numers, ids, alpha, level, p_hat, n_total)
    return json.dumps({"alpha": alpha, "level": level, "omni": omni, "pair": pair})
`;

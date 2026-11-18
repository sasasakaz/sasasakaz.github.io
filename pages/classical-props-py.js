// =====================================================================
// classical-props のPythonコード（Pyodide上で実行）を、JS文字列 CLASSICAL_PROPS_PY として保持するファイル。
//
// 【仕組み】
//  - classical-props.html が tool-common-py.js → 本ファイル → tool-common.js → classical-props.js の順に <script> で読み込む。
//  - tool-common.js の getPyodide() が Pyodide(CDN)と numpy/scipy/matplotlib を読み込み、
//    TOOL_COMMON_PY（共通部分）→ 下のコード の順に pyodide.runPython() で評価する。
//  - 実行ボタンで classical-props.js が Python の run(denoms, numers, alpha) を呼ぶと、
//    表(HTML文字列)とグラフ(SVG文字列)を含むJSONが返り、JSが各idのdivに innerHTML で挿入する。
//      omni(統計量) -> #omni-summary（JSが文章化。χ²・df・p・Cramér's V・合計N・期待度数の最小値）
//      group.table / group.chart -> #group-table / #group-chart（各群の Sample Size・Events・比率とWilson区間）
//      pair.table    -> #pair-table（Pair, diff, χ², df と、補正方法別のp値）
//      pair.warnings -> #pair-warning（期待度数が小さいペア、検定できず p=1.0 にしたペア。JSが文章化）
//      pair.effect_table -> #pair-effect-table（補助指標: 相対差・オッズ比。<details>の中）
//      pair.ci_table -> #pair-ci-table（diff, SE, CI）/ pair.crit -> #pair-ci-note（CIの臨界値。JSが文章化）
//      pair.chart    -> #pair-chart
//      pair.tooltips -> グラフ上のツールチップ用（tool-common.js の attachPairChartTooltips）
//  - 図の表示サイズは classical-props.css（各idのwidthと svg{width:100%}）で決まり、
//    ここの figsize(px指定) は縦横比と文字の相対サイズを決める。
//
// 【編集時の注意】
//  - file:// でも動くよう fetch せず文字列で埋め込んでいる。バッククォート(\`)と
//    \${ は文字列を壊すので、Pythonコード内に書かないこと（f-stringの {} 単体は可）。
//  - run() の戻り値のキーを変えたら classical-props.js 側も合わせて直すこと。
//  - 純粋なPythonは先頭/末尾のバッククォート行の間だけ。インデントはPythonの文法そのもの。
//  - scipy だけで完結させている（Wilson区間・多重比較補正は自前実装。statsmodels/pandas不要）。
//  - ペアの検定は2×2のPearsonカイ二乗検定（Yates補正なし）、CIはWald法（非プールのSE）。
//    両者は計算の仕方が違うので、境界付近ではp値の判定とCIが0を含むかが食い違うことがある（HTML側に注記あり）。
//  - グラフの要素id（set_gid）は pair-ci-{method}-{行} / pair-mean-{method}-{行}。
//    classical-means と同じ接頭辞 "pair" にしてあり、tooltips はJS側の PAIR_METHODS の色と対応する。
// =====================================================================
const CLASSICAL_PROPS_PY = String.raw`
"""classical-props: 古典的検定の計算とmatplotlibによる描画（Pyodide上で実行）。
共通部分（style_axes / new_fig / to_svg / p値補正 / html_table）は tool-common-py.js"""
import json

import numpy as np
from scipy import stats as sps


def wilson(n, d, alpha):
    """Wilson区間（0〜1）"""
    z = sps.norm.ppf(1 - alpha / 2)
    p = n / d
    denom = 1 + z * z / d
    center = (p + z * z / (2 * d)) / denom
    half = z * np.sqrt(p * (1 - p) / d + z * z / (4 * d * d)) / denom
    return center - half, center + half


def omnibus(denoms, numers, ids, alpha, level):
    k = len(denoms)
    n_total = int(sum(denoms))
    table = np.array([numers, [d - n for d, n in zip(denoms, numers)]])
    chi2, p_omni, dof, expected = sps.chi2_contingency(table, correction=False)
    cramers_v = float(np.sqrt(chi2 / n_total))

    p_hat = np.array(numers) / np.array(denoms)
    lo, hi = wilson(np.array(numers, dtype=float), np.array(denoms, dtype=float), alpha)
    rows = [[f"Group {ids[i]}", denoms[i], numers[i], 100 * p_hat[i], 100 * lo[i], 100 * hi[i]]
            for i in range(k)]
    ci_table = html_table(
        ["Group", "Sample Size", "Events", "Rate (%)", f"{level}%CI Lower (%)", f"{level}%CI Upper (%)"],
        ["text", "int", "int", "f2", "f2", "f2"], rows)

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

    omni = {
        "chi2": float(chi2), "df": int(dof), "p": float(p_omni), "v": cramers_v,
        "n": n_total, "min_expected": float(expected.min()),
        "significant": bool(p_omni < alpha),
        "low_expected": bool(expected.min() < 5),
    }
    group = {"table": ci_table, "chart": to_svg(fig)}
    return omni, group, p_hat


def pairwise(denoms, numers, ids, alpha, level, p_hat):
    k = len(denoms)
    pairs = [(i, j) for i in range(k) for j in range(i + 1, k)]
    m = len(pairs)
    dens = np.array(denoms, dtype=float)

    z_unadj = sps.norm.ppf(1 - alpha / 2)
    z_bonf = sps.norm.ppf(1 - alpha / (2 * m))

    rows = []
    for i, j in pairs:
        d = p_hat[j] - p_hat[i]  # 差は「後ろの群(j) − 前の群(i)」（A基点なら B−A, C−A, …）
        # CIに使うSE（Wald法。各群の標本比率から求める非プールのSE）
        se = np.sqrt(p_hat[i] * (1 - p_hat[i]) / dens[i] + p_hat[j] * (1 - p_hat[j]) / dens[j])
        tbl = [[numers[i], denoms[i] - numers[i]], [numers[j], denoms[j] - numers[j]]]
        try:
            chi2, p_raw, dof, expected = sps.chi2_contingency(tbl, correction=False)
            chi2, dof = float(chi2), int(dof)
            low_expected, degenerate = bool(expected.min() < 5), False
        except ValueError:  # 期待度数0（両群とも0%/100%など）: 検定できないので p=1.0 とする
            chi2, dof, p_raw = None, None, 1.0
            low_expected, degenerate = False, True
        # 補助指標。相対差は右の群(i)が基準。基準が0で計算できないものは None（表では「—」）
        rel = 100 * d / p_hat[i] if p_hat[i] > 0 else None
        odds_den = (denoms[j] - numers[j]) * numers[i]
        odds_ratio = numers[j] * (denoms[i] - numers[i]) / odds_den if odds_den > 0 else None
        rows.append({
            "pair": f"{ids[j]} - {ids[i]}", "diff": 100 * d, "se": 100 * se,
            "lo": 100 * (d - z_unadj * se), "hi": 100 * (d + z_unadj * se),
            "blo": 100 * (d - z_bonf * se), "bhi": 100 * (d + z_bonf * se),
            "chi2": chi2, "dof": dof, "p_raw": float(p_raw),
            "rel": None if rel is None else float(rel),
            "odds_ratio": None if odds_ratio is None else float(odds_ratio),
            "low_expected": low_expected, "degenerate": degenerate,
        })
    p_raw_all = np.array([r["p_raw"] for r in rows])
    p_bonf, p_hol, p_bhh = p_bonferroni(p_raw_all), p_holm(p_raw_all), p_bh(p_raw_all)

    def label(r):  # 注意が必要なペアには印をつける（説明は #pair-warning）
        return r["pair"] + (" †" if r["low_expected"] else "") + (" ‡" if r["degenerate"] else "")

    # Pair | diff, χ², df | p値（補正方法別）。左から計算の流れ順に並べる
    test_rows = [[label(r), r["diff"], r["chi2"], r["dof"], r["p_raw"], p_bonf[n], p_hol[n], p_bhh[n]]
                 for n, r in enumerate(rows)]
    test_table = html_table(
        ["Pair", "diff (points)", "χ²", "df", "p (Unadjusted)", "p (Bonferroni)", "p (Holm)", "p (BH)"],
        ["text", "f2", "f2", "int", "p", "p", "p", "p"], test_rows, alpha)
    effect_table = html_table(
        ["Pair", "相対差 (%)", "Odds Ratio"], ["text", "f2", "f2"],
        [[r["pair"], r["rel"], r["odds_ratio"]] for r in rows])
    ci_rows = [[r["pair"], r["diff"], r["se"], r["lo"], r["hi"], r["blo"], r["bhi"]] for r in rows]
    ci_table = html_table(
        ["Pair", "diff (points)", "SE (points)", "CI Lower", "CI Upper", "Bonf CI Lower", "Bonf CI Upper"],
        ["text"] + ["f2"] * 6, ci_rows)

    # 差のCI比較（Unadjusted vs Bonferroni）
    fig, ax = new_fig(640, 55 * m + 150)
    style_axes(ax)
    specs = [("lo", "hi", "Unadjusted", "unadjusted", "#1f77b4", -0.15),
             ("blo", "bhi", "Bonferroni", "bonferroni", "#2ca02c", 0.15)]
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

    tooltips = [{
        "pair": row["pair"],
        "diff": row["diff"],
        "intervals": {
            "unadjusted": [row["lo"], row["hi"]],
            "bonferroni": [row["blo"], row["bhi"]],
        },
    } for row in rows]
    return {
        "pairs": m, "level": level, "table": test_table, "effect_table": effect_table,
        "ci_table": ci_table, "chart": to_svg(fig), "tooltips": tooltips,
        "warnings": {"low_expected": [r["pair"] for r in rows if r["low_expected"]],
                     "degenerate": [r["pair"] for r in rows if r["degenerate"]]},
        "crit": {"z": float(z_unadj), "z_bonf": float(z_bonf), "m": m, "alpha_bonf": alpha / m},
    }


def run(denoms, numers, alpha):
    denoms = [int(x) for x in denoms]
    numers = [int(x) for x in numers]
    alpha = float(alpha)
    k = len(denoms)
    ids = [chr(65 + i) for i in range(k)]
    level = int(round((1 - alpha) * 100))

    omni, group, p_hat = omnibus(denoms, numers, ids, alpha, level)
    pair = pairwise(denoms, numers, ids, alpha, level, p_hat)
    return json.dumps({"alpha": alpha, "level": level, "omni": omni, "group": group, "pair": pair})
`;

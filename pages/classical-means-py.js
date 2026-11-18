// =====================================================================
// classical-means のPythonコード（Pyodide上で実行）を、JS文字列 CLASSICAL_MEANS_PY として保持するファイル。
//
// 【仕組み】
//  - classical-means.html が tool-common-py.js → 本ファイル → tool-common.js → classical-means.js の順に <script> で読み込む。
//  - tool-common.js の getPyodide() が Pyodide(CDN)と numpy/scipy/matplotlib を読み込み、
//    TOOL_COMMON_PY（共通部分）→ 下のコード の順に pyodide.runPython() で評価する。
//  - 実行ボタンで classical-means.js が Python の run(ids, groups, alpha) を呼ぶと、
//    表(HTML文字列)とグラフ(SVG文字列)を含むJSONが返り、JSが各idのdivに innerHTML で挿入する。
//      group.table / group.chart  -> #group-table / #group-chart
//      omni（3群以上のみ。2群は null）-> #omni-summary（JSが文章化）
//      pair.table    -> #pair-table（主表: Pair, diff, relative_diff, Cohen's d, SE, t, dof, p (Holm), Bonferroni同時CI。N・Meanは各群の表にあるので出さない）
//      pair.chart    -> #pair-chart（主グラフ: Bonferroni同時CIのみ）
//      --- 以下は「多重比較の補正」の <details> の中（3群以上のときだけ表示） ---
//      pair.p_table  -> #pair-p-table（補正方法別のp値4列）
//      pair.chart_all -> #pair-chart-all（補正なし/Bonferroniの2本のCI）/ pair.ci_table -> #pair-ci-table
//      pair.tooltips -> グラフ上のツールチップ用（tool-common.js の attachPairChartTooltips）。
//                       主グラフは prefix="pair"、details内のグラフは prefix="pair-all" で呼ぶ
//  - 入力が不正なときは {"error": "..."} を返す。
//  - 変数名の方針: std_biased = 標準偏差（n で割る）、std_unbiased = 不偏標準偏差（n-1 で割る）、
//    var_unbiased = 不偏分散（n-1 で割る）。検定・信頼区間の計算はすべて不偏の値を使う。
//    各群の表の列は Group, N, Mean, Std(biased), Unbiased Std, Unbiased Var, CI Lower, CI Upper。
//
// 【編集時の注意】
//  - file:// でも動くよう fetch せず文字列で埋め込んでいる。バッククォート(\`)と
//    \${ は文字列を壊すので、Pythonコード内に書かないこと（f-stringの {} 単体は可）。
//  - run() の戻り値のキーを変えたら classical-means.js 側も合わせて直すこと。
//  - 純粋なPythonは先頭/末尾のバッククォート行の間だけ。インデントはPythonの文法そのもの。
//  - scipy だけで完結させている（Welch検定・多重比較補正は自前実装。statsmodels/pandas不要）。
//  - 計算は best_5g.ipynb の「welch t検定」セクションに対応している。
//  - グラフの要素id（set_gid）は {prefix}-ci-{method}-{行} / {prefix}-mean-{method}-{行}。
//    主グラフは接頭辞 "pair"、details内のグラフは "pair-all"（同じidが2つ並ばないように分けている）。
//    classical-props と同じ接頭辞にしてあり、tooltips はJS側の PAIR_METHODS の色と対応する。
// =====================================================================
const CLASSICAL_MEANS_PY = String.raw`
"""classical-means: 平均の古典的検定の計算とmatplotlibによる描画（Pyodide上で実行）。
共通部分（style_axes / new_fig / to_svg / p値補正 / html_table）は tool-common-py.js"""
import itertools
import json

import numpy as np
from scipy import stats as sps


def group_summary(ids, xs, alpha, level):
    k = len(xs)
    n = np.array([len(x) for x in xs])
    mean = np.array([np.mean(x) for x in xs])
    std_biased = np.array([np.std(x, ddof=0) for x in xs])  # 標準偏差（n で割る）
    std_unbiased = np.array([np.std(x, ddof=1) for x in xs])  # 不偏標準偏差（n-1 で割る）
    var_unbiased = std_unbiased ** 2  # 不偏分散（n-1 で割る）
    half = sps.t.ppf(1 - alpha / 2, n - 1) * std_unbiased / np.sqrt(n)

    rows = [[f"Group {ids[i]}", n[i], mean[i], std_biased[i], std_unbiased[i], var_unbiased[i],
             mean[i] - half[i], mean[i] + half[i]] for i in range(k)]
    table = html_table(
        ["Group", "N", "Mean", "Std", "Unbiased Std", "Unbiased Var", f"{level}%CI Lower", f"{level}%CI Upper"],
        ["text", "int", "f2", "f2", "f2", "f2", "f2", "f2"], rows)

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
    return n, mean, std_unbiased, table, to_svg(fig)


def welch_anova(n, mean, std_unbiased, alpha):
    k = len(n)
    var_unbiased = std_unbiased ** 2
    w = n / var_unbiased
    mean_w = np.sum(w * mean) / np.sum(w)
    numer = np.sum(w * (mean - mean_w) ** 2) / (k - 1)
    lam = np.sum((1 - w / np.sum(w)) ** 2 / (n - 1))
    f_welch = numer / (1 + 2 * (k - 2) / (k ** 2 - 1) * lam)
    df1 = k - 1
    df2 = (k ** 2 - 1) / (3 * lam)
    p = float(sps.f.sf(f_welch, df1, df2))
    return {"f": float(f_welch), "df1": int(df1), "df2": float(df2), "p": p, "significant": bool(p < alpha)}


def pairwise(ids, n, mean, std_unbiased, alpha, level):
    k = len(n)
    var_unbiased = std_unbiased ** 2
    pairs = list(itertools.combinations(range(k), 2))
    m = len(pairs)
    rows = []
    # Bonferroni は Welch t のまま α/ペア数で計算する
    for i, j in pairs:
        diff = mean[j] - mean[i]  # 差分は「後ろの群(j) − 前の群(i)」（A基点なら B−A, C−A, …）
        se_i = var_unbiased[i] / n[i]
        se_j = var_unbiased[j] / n[j]
        se = np.sqrt(se_i + se_j)
        t_stat = diff / se
        dof = (se_i + se_j) ** 2 / (se_i ** 2 / (n[i] - 1) + se_j ** 2 / (n[j] - 1))  # Welch-Satterthwaite
        p_val = float(sps.t.sf(abs(t_stat), dof) * 2)
        t_crit = sps.t.ppf(1 - alpha / 2, dof)
        # 補助指標（点推定のみ）。relative_diff（相対差）は前の群(i)が基準。基準の平均が0以下だと意味が崩れるので None（表では「—」）
        rel = 100 * diff / mean[i] if mean[i] > 0 else None
        cohens_d = diff / np.sqrt((var_unbiased[i] + var_unbiased[j]) / 2)  # 両群の不偏分散の平均で割る
        row = {"pair": f"{ids[j]} - {ids[i]}", "diff": float(diff), "se": float(se), "t": float(t_stat),
               "dof": float(dof), "p": p_val, "lo": float(diff - t_crit * se), "hi": float(diff + t_crit * se),
               "rel": None if rel is None else float(rel), "d": float(cohens_d)}
        t_bonf = sps.t.ppf(1 - alpha / (2 * m), dof)
        row.update({"blo": float(diff - t_bonf * se), "bhi": float(diff + t_bonf * se)})
        rows.append(row)

    p_raw = np.array([r["p"] for r in rows])
    p_bonf, p_hol, p_bhh = p_bonferroni(p_raw), p_holm(p_raw), p_bh(p_raw)

    # 主表: Pair | diff, relative_diff, Cohen's d | SE, t, dof | p (Holm) | CI（Bonferroni同時CI）
    # N・Mean・不偏分散は各群の表（#group-table）にあるので、ここでは出さない
    main_rows = [[r["pair"], r["diff"], r["rel"], r["d"], r["se"], r["t"], r["dof"], p_hol[x], r["blo"], r["bhi"]]
                 for x, r in enumerate(rows)]
    main_table = html_table(
        ["Pair", "diff (points)", "relative_diff (%)", "Cohen's d", "SE", "t", "dof", "p (Holm)", "CI Lower", "CI Upper"],
        ["text", "f2", "f2", "f2", "f2", "f2", "f2", "p", "f2", "f2"], main_rows, alpha)

    # details用: 補正方法別のp値、補正なし/BonferroniのCI
    p_table = html_table(
        ["Pair", "p (Unadjusted)", "p (Bonferroni)", "p (Holm)", "p (BH)"],
        ["text", "p", "p", "p", "p"],
        [[r["pair"], r["p"], p_bonf[x], p_hol[x], p_bhh[x]] for x, r in enumerate(rows)], alpha)

    adj_ci_table = html_table(
        ["Pair", "diff (points)", "CI Lower", "CI Upper",
         "Bonf CI Lower", "Bonf CI Upper"],
        ["text"] + ["f2"] * 5,
        [[r["pair"], r["diff"], r["lo"], r["hi"], r["blo"], r["bhi"]]
         for r in rows])

    spec_unadj = ("lo", "hi", "Unadjusted", "unadjusted", "#1f77b4", -0.15)
    spec_bonf = ("blo", "bhi", "Bonferroni", "bonferroni", "#2ca02c", 0.15)
    spec_bonf_main = ("blo", "bhi", "Bonferroni", "bonferroni", "#2ca02c", 0.0)  # 1本だけなので行の中央に置く

    def draw_pair_chart(chart_specs, prefix, title, height, legend):
        fig, ax = new_fig(640, height)
        style_axes(ax)
        for lo_c, hi_c, label, method, c, off in chart_specs:
            for r, row in enumerate(rows):
                interval = ax.hlines(r + off, row[lo_c], row[hi_c], color=c, linewidth=3.5,
                                     label=label if r == 0 else None)
                interval.set_gid(f"{prefix}-ci-{method}-{r}")
                mean_pt = ax.plot([row["diff"]], [r + off], "o", markersize=5,
                                  markerfacecolor="white", markeredgecolor="black")[0]
                mean_pt.set_gid(f"{prefix}-mean-{method}-{r}")
        ax.axvline(0, color="gray", linestyle="--", linewidth=1.5, zorder=0)
        ax.set_yticks(range(m))
        ax.set_yticklabels([r["pair"] for r in rows])
        ax.invert_yaxis()
        ax.set_xlabel("Difference in average (points)")
        ax.set_title(title, pad=24 if legend else 6)
        if legend:
            ax.legend(frameon=False, fontsize=8, loc="lower center", bbox_to_anchor=(0.5, 1.02),
                      ncol=3, borderaxespad=0)
        fig.tight_layout()
        return to_svg(fig)

    # 主グラフ（Bonferroni同時CIのみ）と、details内のグラフ（補正なし + Bonferroni）
    # tooltips は2つのグラフで共通（要素idの接頭辞だけ違う）。区間は両方入れてあり、ある方だけが使われる
    tooltips = [{
        "pair": row["pair"], "diff": row["diff"],
        "intervals": {"unadjusted": [row["lo"], row["hi"]],
                      "bonferroni": [row["blo"], row["bhi"]]},
    } for row in rows]

    main_chart = draw_pair_chart([spec_bonf_main], "pair", f"Pairwise differences: {level}% CI (Bonferroni)",
                                 45 * m + 110, False)
    all_chart = draw_pair_chart([spec_unadj, spec_bonf], "pair-all", f"Pairwise differences: {level}% CI",
                                55 * m + 150, True)

    return main_table, main_chart, tooltips, p_table, all_chart, adj_ci_table


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
        if any(np.std(x, ddof=1) == 0 for x in xs):  # 不偏標準偏差が0 = 全て同じ値
            raise ValueError("標準偏差が0の群があるため検定できません（全て同じ値の群があります）")
        level = int(round((1 - alpha) * 100))

        n, mean, std_unbiased, group_table, group_chart = group_summary(ids, xs, alpha, level)
        omni = welch_anova(n, mean, std_unbiased, alpha)
        table, chart, tooltips, p_table, chart_all, ci_table = pairwise(ids, n, mean, std_unbiased, alpha, level)
        return json.dumps({
            "alpha": alpha, "level": level,
            "omni": omni,
            "group": {"table": group_table, "chart": group_chart},
            "pair": {"pairs": k * (k - 1) // 2, "level": level, "table": table, "chart": chart,
                     "p_table": p_table, "chart_all": chart_all, "ci_table": ci_table,
                     "tooltips": tooltips},
        })
    except ValueError as e:
        return json.dumps({"error": str(e)})
`;

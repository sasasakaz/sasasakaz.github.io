// =====================================================================
// beat_5g のPythonコード（Pyodide上で実行）を、JS文字列 BEAT_5G_PY として保持するファイル。
//
// 【仕組み】
//  - beat_5g.html が本ファイルを beat_5g.js より先に <script> で読み込む。
//  - beat_5g.js の loadPyodideRuntime() が Pyodide(CDN)と numpy/matplotlib を読み込み、
//    pyodide.runPython(BEAT_5G_PY) で下のコードを評価する。
//  - 実行ボタンで beat_5g.js が Python の run(denoms, numers, num_samples) を呼ぶと、
//    各グラフのSVG文字列などを含むJSONが返り、JSが下記のidのdivに innerHTML で挿入する。
//      posterior -> #summary-chart / hdis -> #summary-hdi
//      forest    -> #diff-hdi      / diffs -> #diff-chart（1枚ずつ .diff-plot で包む）
//    hover はツールチップ用データ（beat_5g.js の attachPosteriorHover が使用）。
//  - 図の表示サイズは beat_5g.css（各idのwidthと svg{width:100%}）で決まり、
//    ここの figsize(px指定) は縦横比と文字の相対サイズを決める。
//
// 【編集時の注意】
//  - file:// でも動くよう fetch せず文字列で埋め込んでいる。バッククォート(\`)と
//    \${ は文字列を壊すので、Pythonコード内に書かないこと（f-stringの {} 単体は可）。
//  - run() の戻り値のキーを変えたら beat_5g.js 側も合わせて直すこと。
//  - 純粋なPythonは先頭/末尾のバッククォート行の間だけ。インデントはPythonの文法そのもの。
// =====================================================================
const BEAT_5G_PY = String.raw`
"""beat_5g: ベイズ推定の計算とmatplotlibによる描画（Pyodide上で実行）"""
import io
import json

import matplotlib

matplotlib.use("agg")
import matplotlib.pyplot as plt
import numpy as np

PERCENTAGE_FACTOR = 100
HDI_MAIN = 0.94
HDI_INNER = 0.5
DPI = 100
COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#7f7f7f", "#9467bd"]
FORECAST_COLOR = "#729fcf"
PLOT_BG = "white"
ORANGE = "#ff8c00"

plt.rcParams["svg.fonttype"] = "none"  # 文字をテキストのまま出力（選択可能・軽量）


def hdi(samples, level=HDI_MAIN):
    """サンプルから最短区間（最高密度区間）を求める"""
    s = np.sort(np.asarray(samples))
    n = len(s)
    n_in = max(int(np.ceil(level * n)), 1)
    widths = s[n_in - 1:] - s[: n - n_in + 1]
    k = int(np.argmin(widths))
    return float(s[k]), float(s[k + n_in - 1])


def stats(samples, level=HDI_MAIN):
    lower, upper = hdi(samples, level)
    return {"mean": float(np.mean(samples)), "lower": lower, "upper": upper}


def auto_edges(arrays, min_bins=20, max_bins=150):
    """件数と分布の広がりに応じたビン境界。Freedman-Diaconis則の最小幅を全群で共有する"""
    lo = min(float(a.min()) for a in arrays)
    hi = max(float(a.max()) for a in arrays)
    widths = []
    for a in arrays:
        w = np.histogram_bin_edges(a, bins="fd")
        if len(w) > 1:
            widths.append(w[1] - w[0])
    span = hi - lo
    if span <= 0:
        return np.linspace(lo - 0.5, hi + 0.5, min_bins + 1)
    n = int(np.ceil(span / min(widths))) if widths else min_bins
    return np.linspace(lo, hi, int(np.clip(n, min_bins, max_bins)) + 1)


def style_axes(ax, grid_y=False, grid_x=False, grid_color="#e5e5e5", grid_width=0.8):
    ax.set_facecolor(PLOT_BG)
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.tick_params(length=0)
    ax.set_axisbelow(True)
    ax.grid(False)
    if grid_x:
        ax.xaxis.grid(True, color=grid_color, linewidth=grid_width)
    if grid_y:
        ax.yaxis.grid(True, color=grid_color, linewidth=grid_width)


def to_svg(fig):
    buf = io.StringIO()
    fig.savefig(buf, format="svg")
    plt.close(fig)
    svg = buf.getvalue()
    svg = svg[svg.index("<svg"):]
    return svg


def new_fig(w_px, h_px):
    return plt.subplots(figsize=(w_px / DPI, h_px / DPI), dpi=DPI)


def plot_posterior(groups):
    fig, ax = new_fig(640, 320)
    style_axes(ax)
    edges = auto_edges([g["samples"] for g in groups])
    densities = []
    for g in groups:
        d, _, _ = ax.hist(g["samples"], bins=edges, density=True, alpha=0.7,
                          color=g["color"], label=f"Group {g['id']}")
        densities.append(d)
    ax.set_title("Posterior Distributions of Rate")
    ax.set_xlabel("Rate (%)")
    ax.set_ylabel("Density")
    ax.set_xlim(edges[0], edges[-1])
    ax.legend(frameon=False, loc="upper right")
    fig.subplots_adjust(left=0.1, right=0.97, top=0.88, bottom=0.17)
    fig.canvas.draw()
    pos = ax.get_position()
    ymax = ax.get_ylim()[1]
    hover = {
        "axes": [pos.x0, pos.y0, pos.x1, pos.y1],
        "xlim": [float(edges[0]), float(edges[-1])],
        "ylim": [0.0, float(ymax)],
        "edges": edges.tolist(),
        "densities": [d.tolist() for d in densities],
        "groups": [{"id": g["id"], "color": g["color"], "mean": g["mean"],
                    "lower": g["lower"], "upper": g["upper"]} for g in groups],
    }
    return to_svg(fig), hover


def plot_individual_hdis(groups):
    all_vals = np.concatenate([g["samples"] for g in groups])
    xr = (all_vals.min() * 0.8, all_vals.max() * 1.1)
    n = len(groups)
    row_h = 40
    fig, axes = plt.subplots(n, 1, figsize=(720 / DPI, row_h * n / DPI), dpi=DPI, squeeze=False)
    for ax, g in zip(axes[:, 0], groups):
        ax.set_facecolor(PLOT_BG)
        ax.set_xlim(*xr)
        ax.set_ylim(-0.2, 1)
        ax.axis("off")
        ax.add_patch(plt.Rectangle((0, 0), 1, 1, transform=ax.transAxes, color=PLOT_BG, zorder=0))
        ax.hlines(0, g["lower"], g["upper"], color=g["color"], alpha=0.7, linewidth=3, zorder=2)
        ax.plot([g["mean"]], [0], "o", markersize=6, markerfacecolor="white",
                markeredgecolor=g["color"], markeredgewidth=1, alpha=0.7, zorder=3)
        ax.text(g["mean"], 0.6, f"{g['mean']:.2f}", ha="center", va="center", color=g["color"], alpha=0.7, fontsize=9)
        ax.text(g["lower"], 0.6, f"{g['lower']:.2f}", ha="right", va="center", color=g["color"],
                alpha=0.7, fontsize=9, fontweight="bold")
        ax.text(g["upper"], 0.6, f"{g['upper']:.2f}", ha="left", va="center", color=g["color"],
                alpha=0.7, fontsize=9, fontweight="bold")
        ax.text(-0.01, 0.4, f"Group {g['id']}", transform=ax.transAxes, ha="right", va="center", fontsize=10)
    fig.subplots_adjust(left=0.11, right=0.93, top=0.995, bottom=0.005, hspace=0.06)
    return to_svg(fig)


def pair_diffs(groups):
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            yield groups[i]["id"], groups[j]["id"], groups[i]["samples"] - groups[j]["samples"]


def plot_forest(groups):
    pairs = list(pair_diffs(groups))
    all_d = np.concatenate([d for _, _, d in pairs])
    fig, ax = new_fig(640, len(pairs) * 30 + 100)
    style_axes(ax, grid_x=True, grid_color="#ebebeb", grid_width=0.6)
    for k, (a, b, d) in enumerate(pairs):
        m = float(np.mean(d))
        lo, hi = hdi(d, HDI_MAIN)
        ilo, ihi = hdi(d, HDI_INNER)
        ax.hlines(k, lo, hi, color=FORECAST_COLOR, linewidth=1.5, zorder=2)
        ax.hlines(k, ilo, ihi, color=FORECAST_COLOR, linewidth=3, zorder=2)
        ax.plot([m], [k], "o", markersize=4, markerfacecolor="white",
                markeredgecolor=FORECAST_COLOR, markeredgewidth=1, zorder=3)
    ax.axvline(0, color="orange", linewidth=2, zorder=1)
    ax.set_xlim(all_d.min() * 1.1, all_d.max() * 1.1)
    ax.set_ylim(len(pairs) - 0.5, -0.5)
    ax.set_yticks(range(len(pairs)))
    ax.set_yticklabels([f"diff {a} - {b}" for a, b, _ in pairs])
    ax.set_title("Summary of Group Difference (94% HDI)")
    fig.tight_layout()
    return to_svg(fig)


def plot_diff_histograms(groups):
    out = []
    for a, b, d in pair_diffs(groups):
        s = stats(d)
        prob = float(np.mean(d > 0)) * PERCENTAGE_FACTOR
        fig, ax = new_fig(300, 200)
        style_axes(ax)
        edges = auto_edges([d], 20, 100)
        ax.hist(d, bins=edges, density=True, color="skyblue", alpha=0.7)
        ax.set_yticks([])
        ax.set_title(f"diff {a} - {b}", fontsize=15)
        ax.tick_params(labelsize=12)
        ax.axvline(0, ymin=0, ymax=0.6, color="orange", linewidth=1.5)
        ax.annotate("", xy=(s["upper"], 0.05), xytext=(s["lower"], 0.05),
                    xycoords=("data", "axes fraction"), textcoords=("data", "axes fraction"),
                    arrowprops={"arrowstyle": "-", "color": "black", "linewidth": 4,
                                "shrinkA": 0, "shrinkB": 0})
        t = ax.get_xaxis_transform()
        ax.text(s["mean"], 0.8, f"mean = {s['mean']:.2f}", transform=t, ha="center", va="center", fontsize=12)
        ax.text(s["mean"], 0.6, f"{PERCENTAGE_FACTOR - prob:.1f}% <0< {prob:.1f}%", transform=t,
                ha="center", va="center", fontsize=12, color=ORANGE, fontweight="bold")
        ax.text(s["lower"], 0.15, f"{s['lower']:.2f}", transform=t, ha="right", va="center", fontsize=12)
        ax.text(s["upper"], 0.15, f"{s['upper']:.2f}", transform=t, ha="left", va="center", fontsize=12)
        fig.subplots_adjust(left=0.04, right=0.96, top=0.88, bottom=0.15)
        out.append(to_svg(fig))
    return out


def run(denoms, numers, num_samples):
    denoms = list(denoms)
    numers = list(numers)
    num_samples = int(num_samples)
    rng = np.random.default_rng()
    groups = []
    for i, (d, n) in enumerate(zip(denoms, numers)):
        samples = PERCENTAGE_FACTOR * rng.beta(1 + n, 1 + d - n, size=num_samples)
        g = {"id": chr(65 + i), "samples": samples, "color": COLORS[i % len(COLORS)]}
        g.update(stats(samples))
        groups.append(g)

    posterior_svg, hover = plot_posterior(groups)
    return json.dumps({
        "posterior": posterior_svg,
        "hover": hover,
        "hdis": plot_individual_hdis(groups),
        "forest": plot_forest(groups),
        "diffs": plot_diff_histograms(groups),
        "table": [{k: g[k] for k in ("id", "mean", "lower", "upper")} for g in groups],
    })
`;

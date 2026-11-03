// =====================================================================
// ツール系ページ共通のPythonコード（Pyodide上で実行）を、JS文字列 TOOL_COMMON_PY として保持するファイル。
// 対象: classical-means / classical-props / bayesian-props
//
// 【仕組み】
//  - 各ページのHTMLが、本ファイルを「ページ専用の *-py.js」より先に <script> で読み込む。
//  - tool-common.js の getPyodide() が [TOOL_COMMON_PY, ページ専用のPython] の順に pyodide.runPython() する。
//    後から評価するページ専用のPythonは、ここで定義した関数・定数をそのまま使える（同じ名前空間）。
//
// 【ここに置くもの】
//  - matplotlib の共通設定（agg・SVGの文字出力）、DPI / COLORS / PLOT_BG、style_axes / new_fig / to_svg
//  - 多重比較のp値補正（p_bonferroni / p_holm / p_bh）
//  - 結果表のHTML生成 html_table（見た目はクラスで指定。インライン style は使わない）
//      1列目などのラベル  -> <td class="col-label">   （中央揃え。CSSは page-common.css）
//      有意なp値          -> <td class="is-sig">       （黄色。CSSは page-common.css）
//
// 【編集時の注意】
//  - file:// でも動くよう fetch せず文字列で埋め込んでいる。バッククォート(\`)と
//    \${ は文字列を壊すので、Pythonコード内に書かないこと（f-stringの {} 単体は可）。
//  - 関数のシグネチャを変えたら、3ページ分の *-py.js の呼び出し側も直すこと。
//  - 純粋なPythonは先頭/末尾のバッククォート行の間だけ。インデントはPythonの文法そのもの。
// =====================================================================
const TOOL_COMMON_PY = String.raw`
"""ツール系ページ共通: matplotlibのSVG出力、p値補正、結果表のHTML生成（Pyodide上で実行）"""
import io

import matplotlib

matplotlib.use("agg")
import matplotlib.pyplot as plt
import numpy as np

DPI = 100
COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#7f7f7f", "#9467bd"]
PLOT_BG = "white"

plt.rcParams["svg.fonttype"] = "none"  # 文字をテキストのまま出力（選択可能・軽量）


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
    """結果表のHTML文字列を作る。kinds は列ごとの種別:
    text: ラベル（class="col-label"）/ int: 桁区切りの整数 / f2: 小数2桁 /
    p: p値（小数4桁。alpha 未満は class="is-sig"）"""
    head = "".join(f"<th>{h}</th>" for h in headers)
    body = []
    for row in rows:
        cells = []
        for kind, v in zip(kinds, row):
            if kind == "text":
                cells.append(f'<td class="col-label">{v}</td>')
            elif kind == "int":
                cells.append(f"<td>{int(v):,}</td>")
            elif kind == "p":
                cls = ' class="is-sig"' if v < alpha else ""
                cells.append(f"<td{cls}>{v:.4f}</td>")
            else:
                cells.append(f"<td>{v:.2f}</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return (f'<table class="summary-table"><thead><tr>{head}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table>')
`;

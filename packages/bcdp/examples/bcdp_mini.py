#!/usr/bin/env python3
"""
BCDP 精華版：邊界耦合 DP（Boundary-Coupled DP）的 Python 教學實作。

對照文件：packages/bcdp/docs/bcdp.md（章節編號沿用它的）、packages/bcdp/docs/distance.md（加權編輯距離與剪枝）。
正式實作（packages/bcdp/src）：morph-search.ts 與 morph-*.ts（構詞搜尋）、channel-walk.ts（多通道走訪與剪枝）、
dp.ts（一列 DP）、junction.ts（交界狀態的合併）。

    python bcdp_mini.py                 示範查詢：結果、分析與音變說明
    python bcdp_mini.py 查詢 [查詢…]     查自己的詞
    python bcdp_mini.py --trace 查詢     另外印出交界狀態、通道與走訪統計
    python bcdp_mini.py --check [個數] [--bound 1.6]
                                        與窮舉參考實作逐一比對（示範查詢＋隨機查詢）；
                                        --bound 放寬總成本上限，讓每個查詢有更多候選詞根可以比

模型只有一句話（1.2 節）：

    一個分析的成本 ＝ 構詞步驟的成本 ＋ 查詢與整個底層字串（詞綴 · 詞根 · 詞綴）的加權編輯距離

方言規則對整個詞計算，所以可以跨越詞素交界；BCDP 在一次詞圖走訪中求出每個詞根的最低成本。

這個檔案有兩套獨立的計算（下面的「第 N 部分」是本檔的分段；括號中的「第 N 節」是 bcdp.md 的章節）：
- BCDP（第 3–6 部分）：一列 DP、交界狀態與合併、詞綴一層一層合併、還原變體、多通道的詞圖走訪與剪枝。
- 參考實作（第 7 部分）：窮舉所有分析，每個分析對整個底層字串做一次完整的 DP。慢，但定義一目了然。
`--check` 逐一比對兩者（定理 1–3 說兩者必須完全相同）；說明（第 8 部分：哪些詞綴、哪些音變）也由參考實作產生。
兩者共用的只有「定義」：規則、位置語意（target_ok、query_ok）、還原變體的辨認（restore）。

精華版省略的部分（正式實作都有，見 bcdp.md）：
- 片語與空白（1.3 第 5 項）、正規化、編譯好的規則表（distance.md 第 6 節）。
- 包覆單位只收前綴式環綴 (L, ∅, R)；(∅, op, R)、(L, op, ∅)、要求詞根元音開頭的環綴從略。
- 重疊只收 Ca、CV 兩種模板（允許的結束位置是「某個位置以後全部」）；CVCV、full 需要穩定引理（第 6 節）。
- 詞綴各層逐一走訪每個詞綴（正式實作走詞綴 trie，共用開頭的列；結果相同）。
- 合併時記下來源（tag）的回溯說明（第 8 節）；這裡改由參考實作重新找出最佳分析。
- 同分規則（spec 順序）、通道合併、快取、虛擬詞根與自動派生（第 10 節）。
"""

from __future__ import annotations

import random
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import accumulate, product

INF = float('inf')
EPS = 1e-9

# ════════════════════════════════════════════════════════════════════════════
# 1. 設定（硬編碼；正式實作由語言設定檔讀入）
# ════════════════════════════════════════════════════════════════════════════

# 基本編輯成本（distance.md 第 1 節）。「查詢」是使用者輸入的表層形式，「底層」是詞綴與詞根接起來的字串。
DEL = 1.0   # 查詢多一個字元（底層沒有）
INS = 0.8   # 底層多一個字元（查詢沒有）
SUB = 1.5   # 替換（相同字元 0）
VOWELS = set('aeiou')

# 方言規則：(查詢那一側, 底層那一側, 權重, 位置, 說明)。自動補反向，所以對查詢方向是對稱的。
# 位置：any 無限制；initial 底層在詞首或交界開始；final 底層在詞尾或交界結束（1.3 節）。
DIALECT_RULES = [
    ('o', 'au', 0.1, 'any', '噶哈巫語 o ↔ 巴宰語 au'),
    ('o', 'u', 0.1, 'any', 'o ↔ u'),
    ('a', 'aa', 0.1, 'any', '元音合併 a｜a'),
    ('l', 'n', 0.1, 'final', '詞尾 l ↔ n'),
    ("'", '', 0.1, 'initial', '喉塞音（詞首、交界）'),
]
# 構詞音變：只在詞素交界適用（1.3 第 3 項），單向（底層 → 表層）。
ALTERNATIONS = [
    ('d', 't', 0.05, 'final', '構詞音變 t → d（後綴之前）'),
]

PREFIXES = ['pu', 'ma', 'mu', 'pa', 'ta', 'ka', 'minu', 'tau', 'maxa']
SUFFIXES = ['an', 'ay', 'aw', 'un', 'i']
INFIXES = ['in', 'a']
REDUPLICATION = ['Ca', 'CV']
CIRCUMFIXES = [('ta', 'aw'), ('ka', 'an')]     # 前綴式環綴 (L, R)：兩側一起出現，算一個步驟
STEP_COST = 0.3          # 每個構詞步驟的成本
MAX_STEPS = 2            # 前綴、後綴各自最多幾個（另加至多一個中綴、重疊或環綴）
MIN_STEM = 3             # 詞根至少幾個字元
MAX_DISTANCE = 1.0       # 總成本上限 B（不含詞根音節數的成本）
LEMMA_SPREAD = 0.6       # 只保留「最佳 ＋ lemmaSpread」之內的命中（含詞根音節數的成本）
ROOT_SYLLABLE_COST = {1: 0.5, 3: 0.1, 4: 0.2}   # 詞根依音節數另加的成本；沒列的是 0，最大的鍵也套用到更多音節

# 示範詞庫（詞例取自 docs/bcdp.md、docs/distance.md 中已公開的例子）
LEXICON = [
    'daux', 'kita', 'alaw', 'babun', 'bitut', 'kawas', 'sungut', 'pusungut', 'apux', 'baket',
    'dakut', 'samian', 'angit', 'aping', 'dusa', 'kiliw', 'tunur', 'luzuk', 'dius', 'kudung',
    'ban', 'lat', 'rak', 'tau', 'tuku', 'kitaan',
]

DEMO_QUERIES = [
    ('minudox', '方言音變在詞根內：minu- ＋ daux（o ↔ au）'),
    ('maxapux', '規則跨越前綴與詞根的交界：maxa-｜apux 的 a｜a 合併'),
    ('takitaw', '環綴 ta-…-aw，詞根與後綴的 a｜a 合併'),
    ("tau'alawan", '交界上的喉塞音（詞首規則在交界也適用）'),
    ('babulay', '詞尾規則在交界適用：babun ＋ -ay，l ↔ n'),
    ('bitudun', '構詞音變 t → d 只在交界：bitut ＋ -un'),
    ('kinawas', '中綴 <in>：在查詢上還原成 kawas'),
    ('dadaux', 'Ca 重疊：da~daux'),
    ('pausunguday', '中綴 <a> ＋ 後綴 -ay ＋ 構詞音變'),
]


# ════════════════════════════════════════════════════════════════════════════
# 2. 規則與位置語意（bcdp.md 1.3 節）
# ════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Rule:
    source: str          # 查詢那一側
    target: str          # 底層那一側
    weight: float
    pos: str = 'any'     # any | initial | final
    kind: str = 'dialect'   # dialect | alternation
    name: str = ''

    @property
    def crosses(self) -> bool:
        """只有沒有位置限制的方言規則，target 可以跨越交界（至多一個，1.3 第 4 項）。"""
        return self.kind == 'dialect' and self.pos == 'any'


class RuleSet:
    def __init__(self, rules):
        self.rules = list(rules)
        self.by_target = defaultdict(list)          # 依底層字串查規則
        for r in self.rules:
            self.by_target[r.target].append(r)
        self.max_target = max(len(r.target) for r in self.rules)
        self.crossing = [r for r in self.rules if r.crosses]
        # 跨列下界（distance.md 第 4 節）：target 的每個非空真前綴 p → 以 p 開頭、比 p 長的規則的最小權重。
        # 多字元規則可以從較早的列直接跳到較深的列，越過中間的列，所以只看目前這一列的最小值不是下界。
        self.jump, self.jump_cross = {}, {}
        for r in self.rules:
            for d in range(1, len(r.target)):
                p = r.target[:d]
                self.jump[p] = min(self.jump.get(p, INF), r.weight)
                if r.crosses:
                    self.jump_cross[p] = min(self.jump_cross.get(p, INF), r.weight)
        # 長度每差一個字元至少要付的成本（只給參考實作當粗略的下界）
        per_char = [r.weight / abs(len(r.source) - len(r.target)) for r in self.rules if len(r.source) != len(r.target)]
        self.min_len_cost = min([DEL, INS] + per_char)

    def mirror(self) -> 'RuleSet':
        """鏡像（第 5 節）：每條規則的 source、target 反轉，詞首與詞尾對調。
        mirror().distance(reverse(x), reverse(y)) ＝ distance(x, y)，後綴就能照前綴的做法由詞尾往內算。"""
        swap = {'initial': 'final', 'final': 'initial', 'any': 'any'}
        return RuleSet(Rule(r.source[::-1], r.target[::-1], r.weight, swap[r.pos], r.kind, r.name) for r in self.rules)


def build_rules() -> RuleSet:
    rules = []
    for s, t, w, pos, name in DIALECT_RULES:
        rules.append(Rule(s, t, w, pos, 'dialect', name))
        rules.append(Rule(t, s, w, pos, 'dialect', name))
    for s, t, w, pos, name in ALTERNATIONS:
        rules.append(Rule(s, t, w, pos, 'alternation', name))
    return RuleSet(rules)


# 底層字串上每個位置的種類：start（詞首）、end（詞尾）、junction（交界）、fixed（還原變體的固定交界）、internal（詞中）
JUNCTIONS = ('junction', 'fixed')


def target_ok(r: Rule, k_start: str, k_end: str) -> bool:
    """規則的底層那一側在 [起點, 終點) 時，位置限制是否成立（1.3 第 1–3 項）。"""
    if r.kind == 'alternation':                       # 構詞音變：只在交界
        if r.pos == 'initial':
            return k_start in JUNCTIONS
        if r.pos == 'final':
            return k_end in JUNCTIONS
        return k_start in JUNCTIONS or k_end in JUNCTIONS
    if r.pos == 'initial':                            # 詞首規則：詞首或交界
        return k_start == 'start' or k_start in JUNCTIONS
    if r.pos == 'final':                              # 詞尾規則：詞尾或交界
        return k_end == 'end' or k_end in JUNCTIONS
    return True


def query_ok(r: Rule, x: int, ls: int, n: int, k_start: str, k_end: str) -> bool:
    """查詢那一側：在詞首詞尾，詞首（詞尾）規則照舊要求查詢也在詞首（詞尾）；在交界不另外檢查（1.3 第 1、2 項）。"""
    if r.kind == 'dialect':
        if r.pos == 'initial' and k_start == 'start':
            return x - ls == 0
        if r.pos == 'final' and k_end == 'end':
            return x == n
    return True


def root_cost(t: str) -> float:
    """詞根音節數的成本（1.6 第 9 項）：音節數＝元音字母數。"""
    if not ROOT_SYLLABLE_COST:
        return 0.0
    syllables = sum(c in VOWELS for c in t)
    return ROOT_SYLLABLE_COST.get(min(syllables, max(ROOT_SYLLABLE_COST)), 0.0)


# ════════════════════════════════════════════════════════════════════════════
# 3. 一列 DP（bcdp.md 第 3 節、distance.md 第 1–3 節）
# ════════════════════════════════════════════════════════════════════════════
#
# D(x, j)：查詢前 x 個字元對齊底層前 j 個字元的最小成本。固定 j 時 (D(0, j) … D(n, j)) 是「一列」；
# 第 j 列只依賴底層的前 j 個字元，所以共用開頭的詞共用列（詞圖走訪的基礎）。
#
# 一段（一個詞綴或詞根）在自己的座標中計算：rows[0] 是這一段開頭的列（詞首列或交界列），path 是這一段已讀的字元。

def compute_row(q, path, rows, rs, start_kind, pending, end_kind):
    """算這一段的第 k ＝ len(path) 列。

    rows        這一段第 0 … k−1 列（rows[0] 是起點列）
    start_kind  這一段的起點：start（詞首）、junction（交界）、fixed（固定交界）
    pending     起點交界的跨界表（第 4 節）：規則 target 在上一段已讀到的前段 p → p 起點那一列
    end_kind    None：第 k 個位置在詞中（N 列）；junction／end：這一段在這裡結束（F 列，允許詞尾規則與構詞音變）
    """
    k, n = len(path), len(q)

    def kind_at(p):
        if p == 0:
            return start_kind
        if p == k and end_kind is not None:
            return end_kind
        return 'internal'

    k_end = kind_at(k)
    # 這一列可以用的規則：(規則, 來源列（None＝同一列，空的 target）, 起點的位置種類)
    cands = []
    for length in range(0, min(k, rs.max_target) + 1):
        st = k - length
        for r in rs.by_target.get(path[st:], ()):
            if target_ok(r, kind_at(st), k_end):
                cands.append((r, rows[st] if length else None, kind_at(st)))
    # 跨越起點交界的規則：target ＝ p（上一段的尾巴）＋ path（這一段到目前為止的全部）
    for p, prow in pending.items():
        for r in rs.by_target.get(p + path, ()):
            if r.crosses:
                cands.append((r, prow, 'internal'))

    prev = rows[k - 1] if k else None
    row = [INF] * (n + 1)
    for x in range(n + 1):
        if prev is None:                      # 詞首列：D(0, 0) ＝ 0
            v = 0.0 if x == 0 else INF
        else:
            v = prev[x] + INS                 # 底層多一個字元
            if x:
                v = min(v, prev[x - 1] + (0.0 if q[x - 1] == path[-1] else SUB))
        if x:
            v = min(v, row[x - 1] + DEL)      # 查詢多一個字元
        for r, src, k_st in cands:            # 規則 s → t：s 是查詢在 x 結尾的一段，t 是底層在 k 結尾的一段
            ls = len(r.source)
            if ls > x or q[x - ls:x] != r.source or not query_ok(r, x, ls, n, k_st, k_end):
                continue
            base = row[x - ls] if src is None else src[x - ls]
            v = min(v, base + r.weight)
        row[x] = v
    return row


# ════════════════════════════════════════════════════════════════════════════
# 4. 交界狀態、合併與詞綴各層（bcdp.md 第 4、5 節）
# ════════════════════════════════════════════════════════════════════════════
#
# 定理 1（交界狀態充分）：DP 走過交界 J 之後的每一格，只由 J 之後的格子、交界列 R ＝ D(·, J)，
#   以及跨界表 {(規則 target 已讀到的前段, 它起點那一列)} 算出。規則至多跨越一個交界，所以不必記更早的東西。
# 定理 2（合併）：遞推只有「加非負成本」與「取 min」，所以兩個交界狀態逐項取 min，之後算出的每一格
#   等於分別計算再取 min。不同的詞綴鏈只要停在同一個交界，就能合併成一個起點。

@dataclass
class State:
    row: list                                       # 交界列 R(x)
    pending: dict = field(default_factory=dict)     # 跨界表：前段字串 → 列

    def plus(self, c):
        return State([v + c for v in self.row], {p: [v + c for v in r] for p, r in self.pending.items()})

    def clip(self, bound):
        """之後的成本只會增加，超過上限的格子直接設為 ∞。"""
        cut = lambda r: [v if v <= bound + EPS else INF for v in r]
        pending = {p: cut(r) for p, r in self.pending.items()}
        return State(cut(self.row), {p: r for p, r in pending.items() if min(r) < INF})

    def alive(self):
        return min(self.row) < INF or bool(self.pending)


def merge(a, b):
    if a is None:
        return b
    if b is None:
        return a
    pending = dict(a.pending)
    for p, r in b.pending.items():
        pending[p] = [min(x, y) for x, y in zip(pending[p], r)] if p in pending else r
    return State([min(x, y) for x, y in zip(a.row, b.row)], pending)


def walk_segment(q, s, start, start_kind, rs):
    """從交界狀態 start 出發走完一段 s（一個詞綴），得到 s 結尾的交界狀態（Walk_a，第 5 節）。"""
    rows = [start.row]
    for k in range(1, len(s)):
        rows.append(compute_row(q, s[:k], rows, rs, start_kind, start.pending, None))
    end = compute_row(q, s, rows, rs, start_kind, start.pending, 'junction')
    # 新的跨界表：這一段的尾巴 p 是某條可跨界規則 target 的真前段時，記下 p 起點那一列。
    # 只取這一段的列：target 若從更早的一段開始，就跨越兩個交界了。
    pending = {}
    for d in range(1, min(len(s), rs.max_target - 1) + 1):
        p = s[len(s) - d:]
        if p in rs.jump_cross:
            pending[p] = rows[len(s) - d]
    return State(end, pending)


def word_start(q, rs):
    """詞首的交界狀態 L₀：詞首列（含詞首的空 target 規則，例如查詢開頭多一個喉塞音）。"""
    return State(compute_row(q, '', [], rs, 'start', {}, None), {})


def chain_layers(q, affixes, rs):
    """L_s ＝ min_a（Walk_a(L_{s−1}) ＋ c_a）：恰好 s 個詞綴的所有鏈，在最內側交界的合併狀態（第 5 節）。"""
    layers = [word_start(q, rs)]
    for s in range(1, MAX_STEPS + 1):
        kind = 'start' if s == 1 else 'junction'
        merged = None
        for a in affixes:
            merged = merge(merged, walk_segment(q, a, layers[-1], kind, rs).plus(STEP_COST).clip(MAX_DISTANCE))
        if merged is None or not merged.alive():
            break
        layers.append(merged)
    return layers


def to_forward(state, n):
    """鏡像座標換回正向：位置 x′ → n − x′；跨界表的前段反轉成規則 target 的後半段（tail）。"""
    return State(state.row[::-1], {p[::-1]: r[::-1] for p, r in state.pending.items()})


# ════════════════════════════════════════════════════════════════════════════
# 5. 非串接步驟：還原變體（bcdp.md 1.4 節、第 6 節）
# ════════════════════════════════════════════════════════════════════════════
#
# 中綴與重疊不是在兩端加東西：在查詢上辨認出來、拿掉，得到 q′，問題又回到「前綴鏈 · 詞幹 · 後綴鏈」，
# 只是詞幹的兩個交界固定在查詢的位置上（規則不能跨越）。

def restore(q, i, op):
    """在詞幹起點 i 試一個非串接步驟。成功時回傳 (q′, 拿掉的位置, 拿掉的長度, 詞幹最早可以結束的位置)。"""
    if op in INFIXES:
        h = 0                                          # 首輔音（群）
        while i + h < len(q) and q[i + h] not in VOWELS:
            h += 1
        p = i + h
        if h == 0 or not q.startswith(op, p):
            return None
        q2 = q[:p] + q[p + len(op):]
        if p >= len(q2) or q2[p] not in VOWELS:        # 拿掉之後的首輔音仍須是 h
            return None
        if len(q2) - i < MIN_STEM:
            return None
        return q2, p, len(op), p + 1                   # 詞幹必須越過中綴原本的位置
    # 重疊：模板套在查詢的詞幹上（複製方言形式），Ca ＝ 首輔音 ＋ a，CV ＝ 首輔音 ＋ 第一個元音
    red = q[i:i + 2]
    q2 = q[:i] + q[i + 2:]
    rest = q2[i:]
    if len(red) < 2 or len(rest) < MIN_STEM or rest[0] in VOWELS:
        return None
    if op == 'Ca':
        made, need = rest[0] + 'a', 1
    else:
        if rest[1] not in VOWELS:
            return None
        made, need = rest[:2], 2
    if made != red:
        return None
    return q2, i, 2, i + need


def op_label(op):
    return f'<{op}>' if op in INFIXES else f'{op} 重疊'


# ════════════════════════════════════════════════════════════════════════════
# 6. 詞幹：通道、耦合與剪枝（bcdp.md 第 7 節）
# ════════════════════════════════════════════════════════════════════════════

@dataclass(eq=False)
class Channel:
    """一種詞幹的起點與詞尾（第 7 節的表）。所有通道共用一次詞圖走訪。"""
    name: str
    q: str                 # 詞幹對齊的查詢（還原變體是 q′）
    start: State           # 起點：第 0 列與跨界表
    start_kind: str
    end_row: list          # 詞幹在 x 結束時，接上後綴鏈的成本（不允許的位置 ∞）
    end_pending: dict      # 跨越詞尾交界的規則：tail → tail 之後那一列
    word_end: bool         # 也可以直接是詞尾（不接後綴）
    allowed_from: int = 0  # 還原變體：詞幹最早可以結束的位置
    pot: list = None       # 耦合位能

    def __post_init__(self):
        # 耦合位能 pot(x) ＝ min_{x′ ≥ x} end(x′)：詞幹在 x′ 結束至少還要付的耦合成本。
        # 對齊在查詢上只會往後走，所以子樹中任何詞的成本 ≥ min_x（列(x) ＋ pot(x)）（剪枝第 2 項）。
        n = len(self.q)
        end = []
        for x in range(n + 1):
            v = self.end_row[x]
            if self.word_end and x == n and x >= self.allowed_from:
                v = 0.0
            for trow in self.end_pending.values():
                v = min(v, trow[x])
            end.append(v)
        self.pot, run = [INF] * (n + 1), INF
        for x in range(n, -1, -1):
            run = min(run, end[x])
            self.pot[x] = run


class Trie:
    def __init__(self, words):
        self.root = {'word': None, 'children': {}}
        self.size = 1
        for w in words:
            node = self.root
            for c in w:
                if c not in node['children']:
                    node['children'][c] = {'word': None, 'children': {}}
                    self.size += 1
                node = node['children'][c]
            node['word'] = w


@dataclass
class Hit:
    term: str
    raw: float             # 步驟 ＋ 音變（比較總成本上限用）
    root_cost: float       # 詞根音節數的成本（只改名次）
    channel: str

    @property
    def total(self):
        return self.raw + self.root_cost


@dataclass
class Stats:
    nodes: int = 0
    rows: int = 0
    pruned: int = 0


class BCDP:
    def __init__(self, lexicon, rs):
        self.rs = rs
        self.mirror_rs = rs.mirror()
        self.trie = Trie(lexicon)
        self.words = set(lexicon)

    # ── 準備：詞綴兩側的交界狀態與通道 ────────────────────────────────
    def prepare(self, q):
        rs, mrs, n = self.rs, self.mirror_rs, len(q)
        # 前綴各層（第 5 節），合併成 P：詞幹接在 P 之後，就同時考慮了所有 1 … MAX_STEPS 個前綴的鏈
        pre = chain_layers(q, PREFIXES, rs)
        P = None
        for layer in pre[1:]:
            P = merge(P, layer)
        # 後綴：查詢與後綴反轉，用鏡像的規則照前綴的做法算，再換回正向座標
        rq = q[::-1]
        suf_rev = chain_layers(rq, [s[::-1] for s in SUFFIXES], mrs)
        S_rev = None
        for layer in suf_rev[1:]:
            S_rev = merge(S_rev, layer)
        S = to_forward(S_rev, n) if S_rev else State([INF] * (n + 1), {})

        channels = [
            # 接在前綴之後：起點 P（交界），詞尾與 S 耦合，或就是詞尾
            Channel('接在前綴之後', q, P, 'junction', S.row, S.pending, True) if P else None,
            # 沒有前綴：起點是詞首，至少要有一個後綴（整個查詢對一個詞是普通的模糊命中，不是構詞）
            Channel('沒有前綴', q, pre[0], 'start', S.row, S.pending, False),
        ]
        # 前綴式環綴：P_L ＝「前綴鏈 · L」，S_R ＝「R · 後綴鏈」，兩側配對（第 5 節「環綴的兩側」）
        for L, R in CIRCUMFIXES:
            PL = merge(walk_segment(q, L, pre[0], 'start', rs), walk_segment(q, L, P, 'junction', rs) if P else None)
            SR_rev = merge(walk_segment(rq, R[::-1], suf_rev[0], 'start', mrs),
                           walk_segment(rq, R[::-1], S_rev, 'junction', mrs) if S_rev else None)
            start = PL.plus(STEP_COST).clip(MAX_DISTANCE)
            SR = to_forward(SR_rev.clip(MAX_DISTANCE), n)
            if start.alive() and (min(SR.row) < INF or SR.pending):
                channels.append(Channel(f'環綴 {L}-…-{R}', q, start, 'junction', SR.row, SR.pending, False))
        # 還原變體：詞幹起點 i 是詞首，或 P 有限的位置；起點列只有位置 i 有值，交界固定
        for i in range(n + 1):
            starts = ([(0.0, 'start', '詞首')] if i == 0 else []) + ([(P.row[i], 'fixed', '前綴之後')] if P and P.row[i] < INF else [])
            for op in INFIXES + REDUPLICATION:
                got = restore(q, i, op)
                if not got:
                    continue
                q2, _, removed, emin = got
                n2 = len(q2)
                end_row = [S.row[e + removed] if e >= emin else INF for e in range(n2 + 1)]
                for cost, kind, where in starts:
                    if cost + STEP_COST > MAX_DISTANCE + EPS:
                        continue
                    row0 = [INF] * (n2 + 1)
                    row0[i] = cost + STEP_COST
                    channels.append(Channel(f'{op_label(op)}（{where}，起點 {i}，還原成 {q2}）', q2, State(row0, {}), kind,
                                            end_row, {}, True, emin))
        return [c for c in channels if c], P, S

    # ── 種子：相對上限的起點（剪枝第 3 項） ────────────────────────────
    def seed(self, q, P, S):
        """詞幹與查詢的一段完全相同、兩側直接接上 P、S 的分析：真的分析，成本不小於最佳，只要查幾次詞庫。"""
        n, best = len(q), INF
        for i in range(n + 1):
            for k in range(i + MIN_STEM, n + 1):
                t = q[i:k]
                if t not in self.words or t == q:
                    continue
                left = P.row[i] if P else INF
                options = [left + S.row[k]]
                if k == n:
                    options.append(left)          # 接在前綴之後，就是詞尾
                if i == 0:
                    options.append(S.row[k])      # 沒有前綴，接後綴
                raw = min(options)
                if raw <= MAX_DISTANCE + EPS:
                    best = min(best, raw + root_cost(t))
        return best

    # ── 耦合：走到詞尾節點時，這個詞根在這個通道上的精確成本 ────────────────
    def couple(self, ch, path, rows):
        rs, n, k = self.rs, len(ch.q), len(path)
        if n < ch.allowed_from:
            return INF
        best = INF
        # (1) 就是詞尾：F 列（允許詞尾規則，查詢那一側也要在詞尾）在查詢結尾的值
        if ch.word_end and n >= ch.allowed_from:
            best = compute_row(ch.q, path, rows, rs, ch.start_kind, ch.start.pending, 'end')[n]
        # (2) 接後綴、不跨界：詞尾的交界列 ＋ S.row
        if min(ch.end_row) < INF:
            fj = compute_row(ch.q, path, rows, rs, ch.start_kind, ch.start.pending, 'junction')
            best = min(best, min(a + b for a, b in zip(fj, ch.end_row)))
        # (3) 接後綴、有規則跨越交界：target ＝（詞幹的尾巴 head）·（後綴鏈開頭的 tail）
        for tail, trow in ch.end_pending.items():
            for r in rs.crossing:
                t = r.target
                if len(t) <= len(tail) or not t.endswith(tail):
                    continue
                head = t[:len(t) - len(tail)]
                if len(head) > k or not path.endswith(head):
                    continue
                src, ls = rows[k - len(head)], len(r.source)
                for x1 in range(ls, n + 1):
                    if ch.q[x1 - ls:x1] == r.source:
                        best = min(best, src[x1 - ls] + r.weight + trow[x1])
        return best

    # ── 剪枝的下界（定理 3 的 (1)、(2)） ────────────────────────────────
    def lower_bound(self, ch, path, rows):
        """這個節點以下（深度 > k）任何詞在這個通道上的成本下界。"""
        rs, pot, k = self.rs, ch.pot, len(path)
        with_pot = lambda r: min(a + b for a, b in zip(r, pot))
        lb = with_pot(rows[k])                         # 由第 k 列往下走
        for r in range(max(0, k - rs.max_target + 1), k):
            w = rs.jump.get(path[r:k])                  # 由較早的列，以一條多字元規則越過第 k 列
            if w is not None:
                lb = min(lb, with_pot(rows[r]) + w)
        for p, prow in ch.start.pending.items():        # 由上一段開始、還沒走完的規則
            w = rs.jump_cross.get(p + path)
            if w is not None:
                lb = min(lb, with_pot(prow) + w)
        return lb

    # ── 搜尋 ──────────────────────────────────────────────────────────
    def search(self, q, spread=LEMMA_SPREAD, trace=False):
        if len(q) < MIN_STEM + 1:
            return [], Stats()
        channels, P, S = self.prepare(q)
        best = [self.seed(q, P, S)]
        hits, stats = {}, Stats()
        if trace:
            self.print_trace(q, channels, P, S, best[0])

        def visit(node, path, stacks):
            stats.nodes += 1
            k = len(path)
            if node['word'] and k >= MIN_STEM and path != q:
                for ch, rows in stacks:
                    raw = self.couple(ch, path, rows)
                    if raw <= MAX_DISTANCE + EPS:
                        prev = hits.get(path)
                        if prev is None or raw < prev.raw - EPS:
                            hits[path] = Hit(path, raw, root_cost(path), ch.name)
                        best[0] = min(best[0], raw + root_cost(path))
            # 相對上限：最後只保留「最佳 ＋ spread」之內，而最後的最佳不大於現在的最佳，所以各通道共用這個上限
            limit = min(MAX_DISTANCE, best[0] + spread)
            alive = []
            for ch, rows in stacks:
                if self.lower_bound(ch, path, rows) <= limit + EPS:
                    alive.append((ch, rows))
                else:
                    stats.pruned += 1
            for c, child in sorted(node['children'].items()):
                p2 = path + c
                nxt = [(ch, rows + [compute_row(ch.q, p2, rows, self.rs, ch.start_kind, ch.start.pending, None)]) for ch, rows in alive]
                stats.rows += len(nxt)
                if nxt:
                    visit(child, p2, nxt)

        visit(self.trie.root, '', [(ch, [ch.start.row]) for ch in channels])
        if not hits:
            return [], stats
        cutoff = min(h.total for h in hits.values()) + spread
        out = sorted((h for h in hits.values() if h.total <= cutoff + EPS), key=lambda h: (round(h.total, 6), h.term))
        return out, stats

    def print_trace(self, q, channels, P, S, seed):
        fmt = lambda r: ' '.join(f'{"∞":>4}' if v == INF else f'{v:>4.2f}' for v in r)
        print(f'  查詢位置       {" ".join(f"{x:>4}" for x in range(len(q) + 1))}')
        print(f'  P.row（前綴）  {fmt(P.row) if P else "（沒有）"}')
        if P and P.pending:
            print(f'  P 的跨界表     {", ".join(P.pending)}')
        print(f'  S.row（後綴）  {fmt(S.row)}')
        if S.pending:
            print(f'  S 的跨界表     {", ".join(S.pending)}（tail）')
        print(f'  通道 {len(channels)} 個：')
        for ch in channels:
            print(f'    · {ch.name}')
        print(f'  種子（相對上限的起點）：{"∞" if seed == INF else f"{seed:.2f}"}')


# ════════════════════════════════════════════════════════════════════════════
# 7. 參考實作：窮舉所有分析，對整個底層字串做一次完整的 DP（bcdp.md 1.2 節的定義）
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class Analysis:
    raw: float
    steps: int
    morphs: list           # [(字串, 角色)]，角色：prefix、root、suffix、circ-left、circ-right
    op: str | None         # 非串接步驟的寫法：<in>、da~
    qq: str                # 對齊的查詢（還原變體是 q′）
    ops: list              # 對齊路徑上的每一步：(查詢起, 查詢迄, 底層起, 底層迄, 動作)


def align(q, morphs, rs, fixed=None, budget=INF):
    """查詢 q 對底層字串 u ＝ 各詞素接起來，整個詞一起算的加權編輯距離 E_J，附回溯。

    交界上的語意（1.3 節）：規則至多跨越一個交界、只有可跨界的規則能跨；fixed ＝ (i, emin) 時詞根兩端是固定交界：
    不能跨越，對齊在詞根起點那一列必須停在 i，在詞根終點那一列停在 ≥ emin 的位置。
    """
    u = ''.join(f for f, _ in morphs)
    n, m = len(q), len(u)
    cuts = list(accumulate(len(f) for f, _ in morphs))[:-1]
    kinds = {c: 'junction' for c in cuts}
    force = {}
    if fixed:
        root = next(j for j, (_, role) in enumerate(morphs) if role == 'root')
        r0 = sum(len(f) for f, _ in morphs[:root])
        r1 = r0 + len(morphs[root][0])
        for p in (r0, r1):
            if 0 < p < m:
                kinds[p] = 'fixed'
        i, emin = fixed
        force[r0] = {i}
        force[r1] = set(range(emin, n + 1))

    def kind_at(p):
        return 'start' if p == 0 else 'end' if p == m else kinds.get(p, 'internal')

    D = [[INF] * (n + 1) for _ in range(m + 1)]
    back = [[None] * (n + 1) for _ in range(m + 1)]
    for j in range(m + 1):
        cands = []
        for length in range(0, min(j, rs.max_target) + 1):
            st = j - length
            inner = [c for c in cuts if st < c < j]
            if len(inner) > 1 or any(kinds[c] == 'fixed' for c in inner):
                continue
            for r in rs.by_target.get(u[st:j], ()):
                if inner and not r.crosses:
                    continue
                if not inner and not target_ok(r, kind_at(st), kind_at(j)):
                    continue
                cands.append((r, st))
        for x in range(n + 1):
            v, b = (0.0, None) if j == 0 and x == 0 else (INF, None)
            if j:
                if D[j - 1][x] + INS < v:
                    v, b = D[j - 1][x] + INS, (j - 1, x, 'ins')
                if x:
                    same = q[x - 1] == u[j - 1]
                    c = D[j - 1][x - 1] + (0.0 if same else SUB)
                    if c < v:
                        v, b = c, (j - 1, x - 1, '=' if same else 'sub')
            if x and D[j][x - 1] + DEL < v:
                v, b = D[j][x - 1] + DEL, (j, x - 1, 'del')
            for r, st in cands:
                ls = len(r.source)
                if ls > x or q[x - ls:x] != r.source or not query_ok(r, x, ls, n, kind_at(st), kind_at(j)):
                    continue
                c = D[st][x - ls] + r.weight
                if c < v - EPS:
                    v, b = c, (st, x - ls, r)
            D[j][x], back[j][x] = v, b
        if j in force:
            for x in range(n + 1):
                if x not in force[j]:
                    D[j][x] = INF
        # 提早結束：任何路徑都會經過最後 max_target 列中的某一列（規則最多跳這麼多列）
        lo = max(0, j - rs.max_target + 1)
        if min(min(D[r]) for r in range(lo, j + 1)) > budget + EPS:
            return INF, []
    if D[m][n] == INF:
        return INF, []
    ops, j, x = [], m, n
    while back[j][x] is not None:
        pj, px, op = back[j][x]
        ops.append((px, x, pj, j, op))
        j, x = pj, px
    return D[m][n], ops[::-1]


def chains(affixes):
    out = [()]
    for s in range(1, MAX_STEPS + 1):
        out += list(product(affixes, repeat=s))
    return out


PREFIX_CHAINS = chains(PREFIXES)
SUFFIX_CHAINS = chains(SUFFIXES)


def reference_best(q, term, rs):
    """1.2 節的定義：所有分析中成本最低的一個（同分取步驟少的）。成本超過總成本上限時回傳 None。"""
    best = None

    def consider(qq, morphs, steps, op=None, fixed=None):
        nonlocal best
        step_cost = STEP_COST * steps
        u_len = sum(len(f) for f, _ in morphs)
        if step_cost + rs.min_len_cost * abs(u_len - len(qq)) > MAX_DISTANCE + EPS:
            return
        budget = min(MAX_DISTANCE, best.raw if best else INF) - step_cost
        dist, ops = align(qq, morphs, rs, fixed, budget)
        raw = step_cost + dist
        if raw > MAX_DISTANCE + EPS:
            return
        if best is None or raw < best.raw - EPS or (abs(raw - best.raw) <= EPS and steps < best.steps):
            best = Analysis(raw, steps, morphs, op, qq, ops)

    root = [(term, 'root')]
    for pi in PREFIX_CHAINS:
        P = [(a, 'prefix') for a in pi]
        for sigma in SUFFIX_CHAINS:
            S = [(s, 'suffix') for s in sigma]
            if pi or sigma:
                consider(q, P + root + S, len(pi) + len(sigma))
            for L, R in CIRCUMFIXES:
                consider(q, P + [(L, 'circ-left')] + root + [(R, 'circ-right')] + S, 1 + len(pi) + len(sigma))
    for op in INFIXES + REDUPLICATION:
        for i in range(len(q) + 1):
            got = restore(q, i, op)
            if not got:
                continue
            q2, _, _, emin = got
            for pi in PREFIX_CHAINS:
                if not pi and i:
                    continue                    # 沒有前綴時，詞幹只能從詞首開始
                for sigma in SUFFIX_CHAINS:
                    morphs = [(a, 'prefix') for a in pi] + root + [(s, 'suffix') for s in sigma]
                    mark = f'<{op}>' if op in INFIXES else f'{q[i:i + 2]}~'
                    consider(q2, morphs, 1 + len(pi) + len(sigma), mark, (i, emin))
    return best


def reference_search(q, rs, words, spread=LEMMA_SPREAD):
    """參考實作的完整搜尋：每個詞根各自窮舉，再做同樣的 lemmaSpread 截斷。"""
    if len(q) < MIN_STEM + 1:
        return {}
    found = {}
    for t in sorted(set(words)):
        if len(t) >= MIN_STEM and t != q:
            a = reference_best(q, t, rs)
            if a:
                found[t] = a.raw
    if not found:
        return {}
    cutoff = min(raw + root_cost(t) for t, raw in found.items()) + spread
    return {t: raw for t, raw in found.items() if raw + root_cost(t) <= cutoff + EPS}


# ════════════════════════════════════════════════════════════════════════════
# 8. 說明：哪些詞綴、哪些音變（bcdp.md 第 8 節）
# ════════════════════════════════════════════════════════════════════════════

def describe(a: Analysis) -> tuple[str, list[str]]:
    parts = []
    for form, role in a.morphs:
        if role == 'prefix':
            parts.append(f'{form}-')
        elif role == 'suffix':
            parts.append(f'-{form}')
        elif role == 'root':
            parts.append(form if not a.op else (f'{a.op}{form}' if a.op.endswith('~') else f'{a.op} {form}'))
    for form, role in a.morphs:
        if role == 'circ-left':
            parts.insert(0, f'{form}-…')
        if role == 'circ-right':
            parts.append(f'…-{form}（環綴）')
    summary = ' ＋ '.join(parts)

    u = ''.join(f for f, _ in a.morphs)
    cuts = list(accumulate(len(f) for f, _ in a.morphs))
    starts = [0] + cuts[:-1]
    names = [f for f, _ in a.morphs]

    def where(lo, hi):
        if lo == hi:                                    # 空的 target：在一個位置上
            if lo in cuts[:-1]:
                k = cuts.index(lo)
                return f'{names[k]}｜{names[k + 1]} 的交界'
            if lo == 0:
                return '詞首'
            k = next(j for j in range(len(starts)) if starts[j] <= lo < cuts[j])
            return f'{names[k]} 內'
        idx = [j for j in range(len(starts)) if starts[j] < hi and lo < cuts[j]]
        if len(idx) == 1:
            return f'{names[idx[0]]} 內'
        return f'跨越 {"｜".join(names[j] for j in idx)}'

    notes = []
    for x0, x1, j0, j1, op in a.ops:
        if op == '=':
            continue
        qs, us = a.qq[x0:x1] or '∅', u[j0:j1] or '∅'
        if isinstance(op, Rule):
            notes.append(f'{qs} ↔ {us}：{op.name}，{op.weight:g}，{where(j0, j1)}')
        else:
            label = {'sub': '替換', 'ins': '底層多出', 'del': '查詢多出'}[op]
            cost = {'sub': SUB, 'ins': INS, 'del': DEL}[op]
            notes.append(f'{qs} ↔ {us}：{label}，{cost:g}，{where(j0, j1)}')
    return summary, notes


# ════════════════════════════════════════════════════════════════════════════
# 9. 示範與檢查
# ════════════════════════════════════════════════════════════════════════════

def show(engine: BCDP, q: str, note: str = '', trace: bool = False, explain: int = 3):
    print(f'\n■ {q}' + (f'　— {note}' if note else ''))
    hits, stats = engine.search(q, trace=trace)
    if not hits:
        print('  （沒有構詞命中）')
        return
    print(f'  {"詞根":<10}{"步驟＋音變":>8}{"詞根音節":>8}{"合計":>7}   通道')
    for h in hits:
        print(f'  {h.term:<10}{h.raw:>10.2f}{h.root_cost:>10.2f}{h.total:>8.2f}   {h.channel}')
    for h in hits[:explain]:
        a = reference_best(q, h.term, engine.rs)
        summary, notes = describe(a)
        mark = '✓' if abs(a.raw - h.raw) <= 1e-6 else f'✗ 參考實作是 {a.raw:.2f}'
        print(f'  {h.term}：{summary}{"（還原成 " + a.qq + "）" if a.qq != q else ""}　{mark}')
        for line in notes:
            print(f'      {line}')
    trie_nodes = engine.trie.size
    print(f'  走訪：{stats.nodes}／{trie_nodes} 個詞圖節點，算了 {stats.rows} 列，剪掉 {stats.pruned} 次（節點 × 通道）')


def random_query(rng: random.Random, rs: RuleSet) -> str:
    """隨機查詢：詞根加上隨機的詞綴、偶爾的中綴，再隨機套一條方言規則（往查詢的方向）。"""
    while True:
        root = rng.choice([w for w in LEXICON if len(w) >= MIN_STEM])
        if rng.random() < 0.25:
            h = 0
            while h < len(root) and root[h] not in VOWELS:
                h += 1
            if 0 < h < len(root):
                root = root[:h] + rng.choice(INFIXES) + root[h:]
        word = ''.join(rng.choices(PREFIXES, k=rng.randint(0, 2))) + root + ''.join(rng.choices(SUFFIXES, k=rng.randint(0, 1)))
        if rng.random() < 0.6:
            r = rng.choice([r for r in rs.rules if r.kind == 'dialect' and r.target])
            at = [j for j in range(len(word)) if word.startswith(r.target, j)]
            if at:
                j = rng.choice(at)
                word = word[:j] + r.source + word[j + len(r.target):]
        if len(word) >= MIN_STEM + 1:
            return word


def check(engine: BCDP, count: int) -> bool:
    rng = random.Random(20261014)
    queries = [q for q, _ in DEMO_QUERIES] + [random_query(rng, engine.rs) for _ in range(count)]
    bad = 0
    # 兩種截斷都比：lemmaSpread（相對上限的剪枝要精確，定理 3）與不截斷（總成本上限內的每個詞根都要相同）
    for q in queries:
        line = []
        for spread in (LEMMA_SPREAD, INF):
            got = {h.term: h.raw for h in engine.search(q, spread=spread)[0]}
            want = reference_search(q, engine.rs, LEXICON, spread=spread)
            same = got.keys() == want.keys() and all(abs(got[t] - want[t]) <= 1e-6 for t in got)
            bad += not same
            line.append(f'{"✓" if same else "✗"} {len(got)}／{len(want)}')
            if not same:
                for t in sorted(got.keys() | want.keys()):
                    print(f'      spread {spread}：{t}: BCDP {got.get(t)}  參考 {want.get(t)}')
        print(f'  {q:<18} 截斷 {line[0]}　不截斷 {line[1]}（BCDP／參考實作的命中數）')
    print(f'\n{len(queries)} 個查詢 × 2 種截斷，{"全部一致" if not bad else f"{bad} 個不一致"}')
    return bad == 0


def main(argv):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    engine = BCDP(LEXICON, build_rules())
    if argv[:1] == ['--check']:
        global MAX_DISTANCE
        if '--bound' in argv:
            MAX_DISTANCE = float(argv[argv.index('--bound') + 1])
        count = int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 12
        print(f'總成本上限 {MAX_DISTANCE}')
        sys.exit(0 if check(engine, count) else 1)
    trace = '--trace' in argv
    queries = [a for a in argv if not a.startswith('--')]
    print(f'詞庫 {len(LEXICON)} 個詞（詞圖 {engine.trie.size} 個節點）；前綴 {len(PREFIXES)}、後綴 {len(SUFFIXES)}、'
          f'中綴 {len(INFIXES)}、重疊 {len(REDUPLICATION)}、環綴 {len(CIRCUMFIXES)}；規則 {len(engine.rs.rules)} 條')
    print(f'總成本上限 {MAX_DISTANCE}、lemmaSpread {LEMMA_SPREAD}、每個步驟 {STEP_COST}、詞根音節數的成本 {ROOT_SYLLABLE_COST}')
    if queries:
        for q in queries:
            show(engine, q.lower(), trace=trace)
    else:
        for q, note in DEMO_QUERIES:
            show(engine, q, note, trace=trace)


if __name__ == '__main__':
    main(sys.argv[1:])

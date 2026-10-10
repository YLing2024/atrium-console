#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 PWA 图标：纯几何菱形（与个人主页品牌标记一致）。

设计系统配色：暖纸白底 #f7f6f3 / 墨黑 #171512 / 琥珀点缀 #a05b0c。
直角、无渐变、无文字。脚本幂等，可重复运行覆盖旧文件。

需要 Python PIL（Pillow）。运行：
    python3 scripts/gen-pwa-icons.py
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

PAPER = (247, 246, 243, 255)  # #f7f6f3
INK = (23, 21, 18, 255)       # #171512
AMBER = (160, 91, 12, 255)    # #a05b0c

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "public", "icons")

# 超采样倍数：先画大图再缩回，得到干净的抗锯齿边缘。
SS = 4


def _diamond(cx: float, cy: float, half: float):
    """返回以 (cx, cy) 为中心、半对角线为 half 的菱形四个顶点。"""
    return [(cx, cy - half), (cx + half, cy), (cx, cy + half), (cx - half, cy)]


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    canvas = size * SS
    img = Image.new("RGBA", (canvas, canvas), PAPER)
    d = ImageDraw.Draw(img)

    cx = cy = canvas / 2
    # maskable 版本图形收进安全区（四周留 >=10% 边距）。
    outer = canvas * (0.28 if maskable else 0.38)

    # 墨黑外菱形（实心）。
    d.polygon(_diamond(cx, cy, outer), fill=INK)
    # 纸白内菱形，形成直角描边效果。
    d.polygon(_diamond(cx, cy, outer * 0.62), fill=PAPER)
    # 琥珀点缀：中心小菱形。
    d.polygon(_diamond(cx, cy, outer * 0.26), fill=AMBER)

    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, name: str) -> None:
    path = os.path.join(OUT_DIR, name)
    img.save(path, format="PNG")
    print(f"wrote {path}")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    save(draw_icon(192), "icon-192.png")
    save(draw_icon(512), "icon-512.png")
    save(draw_icon(512, maskable=True), "icon-512-maskable.png")
    save(draw_icon(180), "apple-touch-icon-180.png")


if __name__ == "__main__":
    main()

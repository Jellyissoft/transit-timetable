"""홈화면 아이콘 생성(PIL). 외부 폰트 없이 도형만으로 시계+경로 느낌."""
from PIL import Image, ImageDraw

BG = (37, 99, 235)      # 파랑
BG2 = (29, 78, 216)
FG = (255, 255, 255)
ACCENT = (250, 204, 21)  # 노랑(환승 점)


def rounded(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.22)
    # 배경 라운드 사각형(세로 그라데이션 근사: 두 겹)
    d.rounded_rectangle([0, 0, size, size], radius=r, fill=BG)
    d.rounded_rectangle([0, int(size * 0.5), size, size], radius=r, fill=BG2)
    d.rounded_rectangle([0, int(size * 0.5), size, int(size * 0.5) + r], fill=BG2)

    # 경로 라인(대각선) + 정거장 점 3개
    p1 = (int(size * 0.22), int(size * 0.74))
    p2 = (int(size * 0.5), int(size * 0.5))
    p3 = (int(size * 0.78), int(size * 0.26))
    lw = max(2, int(size * 0.045))
    d.line([p1, p2, p3], fill=FG, width=lw, joint="curve")
    rr = int(size * 0.075)
    for i, p in enumerate((p1, p2, p3)):
        col = ACCENT if i == 1 else FG
        d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=col,
                  outline=BG, width=max(1, int(size * 0.02)))
    return img


for s in (180, 512, 192):
    rounded(s).save(f"D:/transit_timetable/icons/icon-{s}.png")
# 마스크블 아이콘용 여백 버전(512, 안전영역 안쪽에 배치)
img = Image.new("RGBA", (512, 512), BG)
inner = rounded(360).resize((360, 360))
img.paste(inner, (76, 76), inner)
img.convert("RGB").save("D:/transit_timetable/icons/maskable-512.png")
print("icons written")

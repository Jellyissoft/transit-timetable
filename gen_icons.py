"""홈화면 아이콘 생성(PIL) — 오리지널 강아지 얼굴(가나디 느낌, 직접 제작). 파스텔 배경."""
from PIL import Image, ImageDraw


def draw_dog(size, pad_ratio=0.0):
    """size×size 아이콘. pad_ratio는 마스커블 안전영역용 여백."""
    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.24)
    # 파스텔 배경(하늘→분홍 근사: 두 겹)
    d.rounded_rectangle([0, 0, S, S], radius=r, fill=(191, 224, 255))     # 하늘
    d.rounded_rectangle([0, int(S * 0.52), S, S], radius=r, fill=(255, 224, 242))  # 분홍 하단
    d.rounded_rectangle([0, int(S * 0.52), S, int(S * 0.52) + r], fill=(255, 224, 242))

    # 얼굴 좌표(0..1 정규화 후 스케일) — 여백 반영
    p = pad_ratio
    def X(x): return int(S * (p + (1 - 2 * p) * x))
    def Y(y): return int(S * (p + (1 - 2 * p) * y))
    def R(v): return int(S * (1 - 2 * p) * v)

    white = (255, 255, 255)
    ear = (236, 238, 246)
    ear_o = (220, 222, 236)
    ink = (64, 58, 88)
    blush = (255, 199, 214)

    # 귀
    d.ellipse([X(.14) - R(.15), Y(.30), X(.14) + R(.15), Y(.30) + R(.46)], fill=ear, outline=ear_o, width=max(1, R(.015)))
    d.ellipse([X(.86) - R(.15), Y(.30), X(.86) + R(.15), Y(.30) + R(.46)], fill=ear, outline=ear_o, width=max(1, R(.015)))
    # 머리
    d.ellipse([X(.5) - R(.34), Y(.52) - R(.34), X(.5) + R(.34), Y(.52) + R(.34)], fill=white, outline=(230, 232, 242), width=max(1, R(.016)))
    # 발그레
    d.ellipse([X(.30) - R(.08), Y(.60) - R(.05), X(.30) + R(.08), Y(.60) + R(.05)], fill=blush)
    d.ellipse([X(.70) - R(.08), Y(.60) - R(.05), X(.70) + R(.08), Y(.60) + R(.05)], fill=blush)
    # 눈
    d.ellipse([X(.385) - R(.065), Y(.50) - R(.085), X(.385) + R(.065), Y(.50) + R(.085)], fill=ink)
    d.ellipse([X(.615) - R(.065), Y(.50) - R(.085), X(.615) + R(.065), Y(.50) + R(.085)], fill=ink)
    d.ellipse([X(.405) - R(.022), Y(.47) - R(.022), X(.405) + R(.022), Y(.47) + R(.022)], fill=white)
    d.ellipse([X(.635) - R(.022), Y(.47) - R(.022), X(.635) + R(.022), Y(.47) + R(.022)], fill=white)
    # 코
    d.ellipse([X(.5) - R(.05), Y(.60) - R(.038), X(.5) + R(.05), Y(.60) + R(.038)], fill=ink)
    # 입(살짝 처진 W)
    lw = max(2, R(.02))
    d.arc([X(.40), Y(.60), X(.50), Y(.70)], 20, 160, fill=ink, width=lw)
    d.arc([X(.50), Y(.60), X(.60), Y(.70)], 20, 160, fill=ink, width=lw)
    return img


draw_dog(180).save("D:/transit_timetable/icons/icon-180.png")
draw_dog(192).save("D:/transit_timetable/icons/icon-192.png")
draw_dog(512).save("D:/transit_timetable/icons/icon-512.png")
# 마스커블: 안전영역 안쪽(여백)에 배치
draw_dog(512, pad_ratio=0.14).convert("RGB").save("D:/transit_timetable/icons/maskable-512.png")
print("dog icons written")

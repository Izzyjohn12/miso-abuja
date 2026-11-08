"""Generate the staff-console install QR as a compact SVG.

Run from the repo root: python _work/make_staff_qr.py
"""
import os

import qrcode
import qrcode.image.svg

TARGET = "https://miso-abuja.pages.dev/staff/"
OUT = os.path.join("assets", "img", "app", "staff-install-qr.svg")


def main():
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
        image_factory=qrcode.image.svg.SvgPathImage,
    )
    qr.add_data(TARGET)
    qr.make(fit=True)

    image = qr.make_image(fill_color="#0b0a09", back_color="#f4efe6")
    image.save(OUT)

    # qrcode's SVG factory leaves the background transparent and emits a
    # single black path. Give it an explicit ivory field and the ink colour.
    with open(OUT, encoding="utf-8") as fh:
        svg = fh.read()
    svg = svg.replace(' fill_color="#0b0a09" back_color="#f4efe6"', "")
    svg = svg.replace(
        '<path ',
        '<rect width="33" height="33" fill="#f4efe6"/><path fill="#0b0a09" ',
        1,
    )
    svg = svg.replace(' fill="#000000"', "")
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(svg)

    print(f"{TARGET} -> {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()

"""OCR low-text PDF pages locally using Poppler and Tesseract command-line tools."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

import pdfplumber


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--minimum-characters", type=int, default=40)
    args = parser.parse_args()
    pdftoppm = shutil.which("pdftoppm")
    tesseract = shutil.which("tesseract")
    if not pdftoppm or not tesseract:
      raise SystemExit("OCR requires pdftoppm (Poppler) and tesseract on PATH.")

    with pdfplumber.open(args.pdf) as document:
        low_text_pages = [
            index
            for index, page in enumerate(document.pages, start=1)
            if len((page.extract_text() or "").strip()) < args.minimum_characters
        ]

    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="examforge-ocr-") as temporary:
        prefix = str(Path(temporary) / "page")
        subprocess.run([pdftoppm, "-png", "-r", "220", str(args.pdf), prefix], check=True)
        for page_number in low_text_pages:
            image = Path(f"{prefix}-{page_number}.png")
            target = args.output / f"page-{page_number:04d}"
            subprocess.run([tesseract, str(image), str(target), "-l", "eng+hin"], check=True)
    print(f"OCR completed for {len(low_text_pages)} low-text page(s).")


if __name__ == "__main__":
    main()

"""Extract an official PDF into a provenance-first review bundle.

This tool never infers questions or answers. It preserves page text so a reviewer
can create the structured import JSON consumed by the protected Worker API.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

import pdfplumber

ALLOWED_DOMAINS = {
    "ssc.gov.in",
    "upsc.gov.in",
    "upsconline.gov.in",
    "rrcb.gov.in",
    "rrbcdg.gov.in",
    "nta.ac.in",
    "nta.nic.in",
    "ibps.in",
}


def allowed_official_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    return parsed.scheme == "https" and any(
        host == domain or host.endswith(f".{domain}") for domain in ALLOWED_DOMAINS
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if not allowed_official_url(args.source_url):
        raise SystemExit("Source URL is not on the official-domain allowlist.")
    raw = args.pdf.read_bytes()
    if len(raw) > 20 * 1024 * 1024:
        raise SystemExit("Document exceeds the 20 MiB ingestion limit.")

    with pdfplumber.open(args.pdf) as document:
        pages = [
            {"page": number, "text": page.extract_text() or ""}
            for number, page in enumerate(document.pages, start=1)
        ]

    bundle = {
        "document": {
            "sourceId": args.source_id,
            "sourceUrl": args.source_url,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "fileName": args.pdf.name,
            "mimeType": "application/pdf",
            "byteSize": len(raw),
            "pageCount": len(pages),
        },
        "extraction": {
            "parserVersion": f"pdfplumber-{pdfplumber.__version__}",
            "ocrUsed": False,
            "pages": pages,
        },
        "questions": [],
        "reviewRequired": True,
        "answerKeysGenerated": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {args.output} ({len(pages)} pages); manual structuring is required.")


if __name__ == "__main__":
    main()

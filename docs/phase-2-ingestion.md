# Phase 2 ingestion and review

Only HTTPS URLs belonging to a configured examination authority may be registered.
The source record is created first, then a local operator hashes and extracts the
document:

```powershell
python tools/ingestion/extract_pdf.py official.pdf `
  --source-id <uuid> `
  --source-url https://ssc.gov.in/... `
  --output tmp/official.review.json
```

The extractor preserves page text and deliberately emits no questions or answers.
Scanned pages should be rendered and OCRed locally, then the output must be reviewed.
`python tools/ingestion/ocr_pdf.py official.pdf --output tmp/ocr` performs
page-level OCR when Poppler and Tesseract are available.
Submit at most 20 structured questions per request to
`POST /api/admin/imports/questions`. A final official answer key must be registered
as a separate source and versioned before an official PYQ can be published.

Admin requests use `Cf-Access-Jwt-Assertion` in preview/production. Local development
uses `x-local-admin-token`, configured only in ignored `.dev.vars`. Unauthorized
admin routes return 404.

Document bytes are stored only when the source copyright classification permits
managed reproduction. Restricted sources retain metadata and citations, not copied
files. Uploaded bytes are streamed directly to R2; the SHA-256 path is computed by
the controlled local extractor before upload.

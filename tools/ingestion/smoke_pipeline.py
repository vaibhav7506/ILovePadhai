"""Exercise Phase 2 database gates in a disposable in-memory SQLite database."""

from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for migration in sorted((ROOT / "db/migrations").glob("*.sql")):
        db.executescript(migration.read_text("utf-8"))

    stamp = "2026-07-30T00:00:00.000Z"
    db.execute(
        """INSERT INTO official_sources
           (id, authority_id, examination_id, content_type, source_url, copyright_status,
            enabled, created_at)
           VALUES ('source-paper', 'authority-ssc', 'exam-ssc-cgl', 'question_paper',
                   'https://ssc.gov.in/', 'metadata_only', 1, ?)""",
        (stamp,),
    )
    db.execute(
        """INSERT INTO official_sources
           (id, authority_id, examination_id, content_type, source_url, copyright_status,
            enabled, created_at)
           VALUES ('source-key', 'authority-ssc', 'exam-ssc-cgl', 'final_answer_key',
                   'https://ssc.gov.in/home/answer-key', 'metadata_only', 1, ?)""",
        (stamp,),
    )
    db.execute(
        """INSERT INTO source_documents
           (id, source_id, sha256, file_name, mime_type, byte_size, page_count,
            reproduction_status, retrieved_at, extraction_status, created_at)
           VALUES ('doc', 'source-paper', ?, 'paper.pdf', 'application/pdf', 1, 1,
                   'metadata_only', ?, 'completed', ?)""",
        ("a" * 64, stamp, stamp),
    )
    db.execute(
        """INSERT INTO questions
           (id, document_id, examination_id, qualification_level, tier_stage, year,
            section, subject, topic, difficulty, question_text, positive_marks,
            negative_marks, source_page, language, content_origin,
            verification_status, content_hash, created_at)
           VALUES ('q', 'doc', 'exam-ssc-cgl', 'graduate', 'Tier I', 2025,
                   'General', 'Reasoning', 'Fixture', 'unrated', 'Pipeline gate fixture?',
                   2, 0.5, 1, 'en', 'official_pyq', 'verified_official', ?, ?)""",
        ("b" * 64, stamp),
    )
    for index in range(4):
        db.execute(
            "INSERT INTO question_options VALUES (?, 'q', ?, ?)",
            (f"o{index}", index, f"Option {index}"),
        )

    blocked = False
    try:
        db.execute("UPDATE questions SET verification_status = 'published' WHERE id = 'q'")
    except sqlite3.IntegrityError:
        blocked = True
    assert blocked, "publication without a final key must be blocked"

    db.execute(
        """INSERT INTO answer_key_versions
           (id, question_id, source_id, key_type, version_label, correct_option_index,
            is_current, reviewer_ref, effective_at, created_at)
           VALUES ('key', 'q', 'source-key', 'final', 'final-v1', 1, 1,
                   'smoke-reviewer', ?, ?)""",
        (stamp, stamp),
    )
    db.execute("UPDATE questions SET verification_status = 'published' WHERE id = 'q'")
    assert db.execute(
        "SELECT verification_status FROM questions WHERE id = 'q'"
    ).fetchone()[0] == "published"

    duplicate_blocked = False
    try:
        db.execute(
            """INSERT INTO source_documents
               (id, source_id, sha256, file_name, mime_type, byte_size, page_count,
                reproduction_status, retrieved_at, extraction_status, created_at)
               VALUES ('doc-duplicate', 'source-paper', ?, 'duplicate.pdf',
                       'application/pdf', 1, 1, 'metadata_only', ?, 'pending', ?)""",
            ("a" * 64, stamp, stamp),
        )
    except sqlite3.IntegrityError:
        duplicate_blocked = True
    assert duplicate_blocked, "duplicate document hash must be blocked"

    db.execute(
        """INSERT INTO anonymous_visitors
           (visitor_number, visitor_uuid, first_seen_at, last_seen_at, visit_count, device_category)
           VALUES (1, '11111111-1111-4111-8111-111111111111', ?, ?, 1, 'desktop')""",
        (stamp, stamp),
    )
    db.execute(
        """INSERT INTO attempts
           (id, visitor_number, examination_id, mode, tier_stage, selection_json, status,
            question_count, duration_seconds, started_at, expires_at, created_at)
           VALUES ('attempt', 1, 'exam-ssc-cgl', 'standard', 'Tier I', '{}',
                   'active', 1, 60, ?, ?, ?)""",
        (stamp, "2026-07-30T00:01:00.000Z", stamp),
    )
    db.execute(
        """INSERT INTO attempt_questions
           (attempt_id, question_id, position, section, topic, positive_marks, negative_marks)
           VALUES ('attempt', 'q', 1, 'General', 'Fixture', 2, 0.5)"""
    )
    db.execute(
        """INSERT INTO attempt_question_results
           (attempt_id, question_id, selected_option_index, correct_option_index,
            outcome, score_awarded, created_at)
           VALUES ('attempt', 'q', 1, 1, 'correct', 2, ?)""",
        (stamp,),
    )
    db.execute(
        """UPDATE attempts SET status = 'submitted', submitted_at = ?,
           submission_reason = 'manual', score_json = '{"finalScore":2}' WHERE id = 'attempt'""",
        (stamp,),
    )
    terminal_blocked = False
    try:
        db.execute("UPDATE attempts SET status = 'active' WHERE id = 'attempt'")
    except sqlite3.IntegrityError:
        terminal_blocked = True
    assert terminal_blocked, "terminal attempts must not reopen"
    result_mutation_blocked = False
    try:
        db.execute(
            "UPDATE attempt_question_results SET score_awarded = 0 WHERE attempt_id = 'attempt'"
        )
    except sqlite3.IntegrityError:
        result_mutation_blocked = True
    assert result_mutation_blocked, "scored question results must remain immutable"
    print(
        "Phase 2/3 pipeline smoke test passed: publication, duplicate, "
        "terminal-attempt and immutable-score gates enforced."
    )


if __name__ == "__main__":
    main()

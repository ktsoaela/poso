from session_mail.config import load_settings
from session_mail.db import init_db, reset_db_state, session_scope
from session_mail.models import BlockEntry
from session_mail.spam.bayes import evaluate, remember, score_text, train


def _ready(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SESSION_SECRET_STORE", "file")
    monkeypatch.setenv("SESSION_DISABLE_SYNC", "1")
    reset_db_state()
    init_db(load_settings())


def test_spam_scores_higher_than_ham(tmp_path, monkeypatch):
    _ready(tmp_path, monkeypatch)
    with session_scope() as db:
        for _ in range(4):
            train(db, 1, "cheap pills won prize click winner lottery", True)
            train(db, 1, "meeting notes project invoice agenda minutes", False)
        spam = score_text(db, 1, "winner won cheap prize lottery")
        ham = score_text(db, 1, "meeting agenda project notes")
    assert spam > ham
    assert spam > 0.8
    assert ham < 0.5


def test_allowlist_beats_blocklist_and_block_moves(tmp_path, monkeypatch):
    _ready(tmp_path, monkeypatch)
    with session_scope() as db:
        remember(db, BlockEntry, 1, "bad@spam.test")
        action, _score = evaluate(db, 1, "hello friend", "bad@spam.test")
        assert action == "move"
        from session_mail.models import AllowEntry

        remember(db, AllowEntry, 1, "bad@spam.test")
        action, _score = evaluate(db, 1, "winner won cheap prize", "bad@spam.test")
        assert action == "allow"

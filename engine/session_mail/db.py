from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from session_mail.config import Settings
from session_mail.models import Base, MailSession, Setting

_settings: Settings | None = None
_engine: Engine | None = None
_Session: sessionmaker[Session] | None = None
_lock = threading.RLock()

FTS_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  subject, from_email, from_name, snippet, body_text,
  content='messages', content_rowid='id',
  tokenize='porter unicode61'
)
"""

TRIGGER_SQL = [
    """
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO message_fts(rowid, subject, from_email, from_name, snippet, body_text)
      VALUES (
        new.id, new.subject, new.from_email, new.from_name, new.snippet,
        coalesce(new.body_text, '')
      );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO message_fts(message_fts, rowid, subject, from_email, from_name, snippet, body_text)
      VALUES (
        'delete', old.id, old.subject, old.from_email, old.from_name, old.snippet,
        coalesce(old.body_text, '')
      );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO message_fts(message_fts, rowid, subject, from_email, from_name, snippet, body_text)
      VALUES (
        'delete', old.id, old.subject, old.from_email, old.from_name, old.snippet,
        coalesce(old.body_text, '')
      );
      INSERT INTO message_fts(rowid, subject, from_email, from_name, snippet, body_text)
      VALUES (
        new.id, new.subject, new.from_email, new.from_name, new.snippet,
        coalesce(new.body_text, '')
      );
    END
    """,
]


def current_settings() -> Settings:
    if _settings is None:
        raise RuntimeError("database is not initialized")
    return _settings


def reset_db_state() -> None:
    global _engine, _Session, _settings
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _Session = None
    _settings = None


def init_db(settings: Settings) -> None:
    global _engine, _Session, _settings
    reset_db_state()
    _settings = settings
    engine = create_engine(
        f"sqlite:///{settings.db_path}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _record) -> None:  # type: ignore[no-untyped-def]
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    Base.metadata.create_all(engine)
    _add_missing_columns(engine)
    with engine.begin() as conn:
        conn.exec_driver_sql(FTS_SQL)
        for statement in TRIGGER_SQL:
            conn.exec_driver_sql(statement)
    _engine = engine
    _Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with session_scope() as db:
        _seed_sessions(db)


def _sql_default(column) -> str:
    default = column.default
    value = getattr(default, "arg", None) if default is not None else None
    if value is None or callable(value):
        return "NULL" if column.nullable else "''"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _add_missing_columns(engine: Engine) -> None:
    """Older mail.db files predate some columns; add them in place so upgrades keep mail."""
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {row[1] for row in conn.exec_driver_sql(f'PRAGMA table_info("{table.name}")').all()}
            if not existing:
                continue
            for column in table.columns:
                if column.name in existing:
                    continue
                kind = column.type.compile(dialect=engine.dialect)
                conn.exec_driver_sql(
                    f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {kind} DEFAULT {_sql_default(column)}'
                )


def _seed_sessions(db: Session) -> None:
    count = db.scalar(select(func.count()).select_from(MailSession)) or 0
    if count:
        return
    business = MailSession(name="Business", color="#4f46e5", sort_order=0)
    personal = MailSession(name="Personal", color="#e11d48", sort_order=1)
    db.add_all([business, personal])
    db.flush()
    db.merge(Setting(key="active_session_id", value=str(business.id)))
    db.merge(Setting(key="theme", value="system"))
    db.merge(Setting(key="density", value="comfortable"))
    db.merge(Setting(key="load_remote_images", value="0"))


@contextmanager
def session_scope() -> Iterator[Session]:
    if _Session is None:
        raise RuntimeError("database is not initialized")
    with _lock:
        db = _Session()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


def fts_search_ids(db: Session, match: str, session_id: int, limit: int) -> list[int]:
    rows = db.execute(
        text(
            """
            SELECT messages.id
            FROM message_fts
            JOIN messages ON messages.id = message_fts.rowid
            JOIN accounts ON accounts.id = messages.account_id
            WHERE message_fts MATCH :match AND accounts.session_id = :session_id
            ORDER BY rank
            LIMIT :limit
            """
        ),
        {"match": match, "session_id": session_id, "limit": limit},
    ).all()
    return [int(row[0]) for row in rows]

import sqlite3
from pathlib import Path

DOSSIER_BACKEND = Path(__file__).parent
DB_PATH = DOSSIER_BACKEND / "data" / "quiz.db"
SCHEMA_PATH = DOSSIER_BACKEND / "schema.sql"


def get_connection():
    DB_PATH.parent.mkdir(exist_ok=True)
    connexion = sqlite3.connect(DB_PATH)
    connexion.row_factory = sqlite3.Row
    connexion.execute("PRAGMA foreign_keys = ON")
    return connexion


def init_db():
    connexion = get_connection()
    connexion.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    connexion.commit()
    connexion.close()
    restreindre_acces_fichier()


def restreindre_acces_fichier():
    """La base contient les hachages de mots de passe. SQLite la crée en 644 :
    sur une machine partagée, tout autre compte pourrait la lire."""
    if DB_PATH.exists():
        DB_PATH.chmod(0o600)

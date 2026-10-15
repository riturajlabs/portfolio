"""Locating the applied and expected Alembic revisions.

The paths are resolved relative to this file rather than the process working
directory, so `/ready` answers correctly however uvicorn or pytest was invoked.
"""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
ALEMBIC_SCRIPT_LOCATION = BACKEND_ROOT / "alembic"
VERSIONS_LOCATION = ALEMBIC_SCRIPT_LOCATION / "versions"


def expected_head() -> str:
    """The head revision the running code expects.

    Derived from the migration scripts on disk, so adding a revision changes
    readiness without touching application code.
    """
    config = Config(str(ALEMBIC_INI)) if ALEMBIC_INI.exists() else Config()
    config.set_main_option("script_location", str(ALEMBIC_SCRIPT_LOCATION))
    script = ScriptDirectory.from_config(config)
    head = script.get_current_head()
    if head is None:
        raise RuntimeError("No Alembic revision is defined under alembic/versions.")
    return head


def revision_files() -> list[str]:
    """Sorted file names of every revision on disk."""
    return sorted(path.name for path in VERSIONS_LOCATION.glob("*.py"))
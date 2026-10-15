"""SQLAlchemy 2.x declarative mappings for the 9 application tables.

`DATABASE.md` §0 is the authority for this list. `project_technology`,
`project_category`, `social_link`, `education`, `about_card`, `blog_post`,
`redirect` and `media_asset` were all rejected and must never be added;
`tests/test_database_schema.py` asserts the table set is exactly these nine.
"""

from app.db.base import Base
from app.models.admin_audit_log import AdminAuditLog
from app.models.admin_session import AdminSession
from app.models.admin_user import AdminUser
from app.models.certification import Certification
from app.models.contact_message import ContactMessage
from app.models.project import Project
from app.models.site_profile import SiteProfile
from app.models.skill import Skill
from app.models.skill_category import SkillCategory

__all__ = [
    "Base",
    "SiteProfile",
    "Project",
    "SkillCategory",
    "Skill",
    "Certification",
    "ContactMessage",
    "AdminUser",
    "AdminSession",
    "AdminAuditLog",
    "expected_table_names",
]


def expected_table_names() -> frozenset[str]:
    """The application tables this code defines.

    `DATABASE.md` §0 fixes this at nine. Readiness verifies that exactly these
    are present, so a half-applied migration cannot pass as ready.
    """
    return frozenset(table.name for table in Base.metadata.tables.values())
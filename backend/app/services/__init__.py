"""Domain services.

A service owns the rules; a route translates HTTP into a service call and a
dependency reuses the same call. Anything that needs a transaction, a password
hash or a time comparison lives here rather than in a route body, so there is one
implementation to review and one place where the reasoning is written down.
"""

from __future__ import annotations
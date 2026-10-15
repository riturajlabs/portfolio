from __future__ import annotations

import pytest

from db.admin import _validated_credentials


def test_admin_credentials_require_both_environment_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)

    with pytest.raises(ValueError, match="ADMIN_EMAIL is required"):
        _validated_credentials()


def test_admin_credentials_validate_email_and_password(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_EMAIL", "not-an-email")
    monkeypatch.setenv("ADMIN_PASSWORD", "long-enough-local-password")

    with pytest.raises(ValueError, match="ADMIN_EMAIL must be a valid email address"):
        _validated_credentials()

    monkeypatch.setenv("ADMIN_EMAIL", "owner@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "short")
    with pytest.raises(ValueError, match="ADMIN_PASSWORD must be at least"):
        _validated_credentials()


def test_admin_credentials_are_normalised_without_exposing_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    password = "long-enough-local-password"
    monkeypatch.setenv("ADMIN_EMAIL", " Owner@Example.COM ")
    monkeypatch.setenv("ADMIN_PASSWORD", password)

    email, configured_password = _validated_credentials()

    assert email == "owner@example.com"
    assert configured_password == password

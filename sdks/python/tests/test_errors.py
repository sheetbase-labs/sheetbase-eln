"""Tests for the error hierarchy and error envelope parsing."""
import pytest

from sheetbase.errors import (
    SheetbaseError,
    TokenError,
    DataPathError,
    ValidationError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
    StaleVersionError,
    ConflictError,
    MissingLinkError,
    InvalidTransitionError,
    InvalidPropertiesError,
    TemplateNotInstantiableError,
    RateLimitedError,
    ServiceUnavailableError,
    ServerError,
    data_path_error,
)


class TestTokenError:
    def test_attributes(self):
        err = TokenError("invalid_credential", "Wrong secret.")
        assert err.code == "invalid_credential"
        assert "invalid_credential" in str(err)
        assert "Wrong secret." in str(err)

    def test_is_sheetbase_error(self):
        err = TokenError("revoked", "Credential revoked.")
        assert isinstance(err, SheetbaseError)


class TestDataPathError:
    @pytest.mark.parametrize(
        "category,expected_cls",
        [
            ("validation_error", ValidationError),
            ("not_found", NotFoundError),
            ("permission_denied", PermissionDeniedError),
            ("unauthenticated", UnauthenticatedError),
            ("stale_version", StaleVersionError),
            ("conflict", ConflictError),
            ("missing_link", MissingLinkError),
            ("invalid_transition", InvalidTransitionError),
            ("invalid_properties", InvalidPropertiesError),
            ("template_not_instantiable", TemplateNotInstantiableError),
            ("rate_limited", RateLimitedError),
            ("service_unavailable", ServiceUnavailableError),
            ("server_error", ServerError),
        ],
    )
    def test_category_mapping(self, category, expected_cls):
        err = data_path_error(category, "test message", "req-123")
        assert isinstance(err, expected_cls)
        assert err.category == category
        assert err.request_id == "req-123"
        assert "test message" in str(err)
        assert "req-123" in str(err)

    def test_unmapped_category_returns_base(self):
        err = data_path_error("unknown_category", "test")
        assert isinstance(err, DataPathError)
        assert not isinstance(err, ValidationError)

    def test_none_request_id(self):
        err = data_path_error("validation_error", "test", None)
        assert err.request_id is None
        assert "request_id" not in str(err)

    def test_all_data_path_errors_are_sheetbase_errors(self):
        for category in [
            "validation_error", "not_found", "permission_denied",
            "stale_version", "conflict", "rate_limited", "server_error",
        ]:
            err = data_path_error(category, "test")
            assert isinstance(err, SheetbaseError)
            assert isinstance(err, DataPathError)

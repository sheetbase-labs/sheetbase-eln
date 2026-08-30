"""SDK version — used for the User-Agent header and compatibility checks."""

__version__ = "0.1.0"

# The API contract version this SDK targets. The server currently uses
# unversioned /api/db paths (contract v0.1). This constant lets the SDK
# warn if a future server reports an incompatible contract version.
API_VERSION = "0.1"

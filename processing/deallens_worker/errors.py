"""Typed processing errors. `code` and `safe_message` are persisted and may be shown to users;
details that could leak document contents or internals are never placed in them."""


class ProcessingError(Exception):
    retryable = False

    def __init__(self, code: str, safe_message: str):
        super().__init__(f"{code}: {safe_message}")
        self.code = code
        self.safe_message = safe_message

    def __reduce__(self):
        # Errors raised in the extraction subprocess must be picklable with their typed fields intact.
        return (type(self), (self.code, self.safe_message))


class UnsupportedDocument(ProcessingError):
    """Deterministic: the file will never succeed as-is (wrong type, scanned PDF, macros...)."""


class MalformedDocument(ProcessingError):
    """Deterministic: the file is corrupt or exceeds resource limits."""


class TransientError(ProcessingError):
    """Infrastructure problem (storage/network). Safe to retry."""
    retryable = True

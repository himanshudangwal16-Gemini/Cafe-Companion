"""Input sanitization and prompt-injection defense utilities."""
import re
from typing import Tuple

CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
WHITESPACE_RE = re.compile(r"\s+")

# Common prompt-injection patterns detected for audit flagging & strict data-fencing
INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions?", re.I),
    re.compile(r"disregard\s+(your|all|the)\s+(system|previous)\s+(prompt|rules|instructions)", re.I),
    re.compile(r"reveal\s+(your\s+)?(system\s+prompt|api\s*key|secret|credentials)", re.I),
    re.compile(r"(you\s+are\s+now|act\s+as)\s+(dan|root|admin|unrestricted)", re.I),
    re.compile(r"<\s*/?\s*(system|instruction|developer)\s*>", re.I),
    re.compile(r"(drop\s+table|delete\s+all\s+orders|set\s+price\s+to\s+0)", re.I),
]


def sanitize_text(value: str, max_length: int = 400) -> str:
    """Strip control characters, collapse excess whitespace, and enforce length bounds."""
    if not value:
        return ""
    cleaned = CONTROL_CHARS_RE.sub("", value)
    cleaned = WHITESPACE_RE.sub(" ", cleaned).strip()
    return cleaned[:max_length]


def inspect_prompt_safety(text: str) -> Tuple[bool, str]:
    """Return (is_suspicious, sanitized_text) so callers can fence untrusted content."""
    clean = sanitize_text(text, max_length=600)
    for pattern in INJECTION_PATTERNS:
        if pattern.search(clean):
            return True, clean
    return False, clean


def wrap_untrusted(label: str, content: str) -> str:
    """Fence untrusted user/retrieved content inside XML-style delimiters."""
    safe = content.replace("</untrusted_", "<\\/untrusted_")
    return f"<untrusted_{label}>\n{safe}\n</untrusted_{label}>"

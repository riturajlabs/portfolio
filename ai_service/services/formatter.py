import re
from typing import Any

# 1. Pre-compile Regex at the module level for O(1) performance in production
# [^\s]* ensures we capture languages with special chars like c++, f#, html/css
CODE_BLOCK_PATTERN = re.compile(r"```([^\s]*)[ \t]*\n")
TRAILING_WHITESPACE_PATTERN = re.compile(r"[ \t]+\n")
EXTRA_NEWLINES_PATTERN = re.compile(r"\n{3,}")


def normalize_text(value: Any) -> str:
    """
    Normalizes text response by fixing carriage returns and stripping edges.
    """
    if isinstance(value, str):
        return value.replace("\r\n", "\n").strip()
    return ""


def normalize_code_blocks(text: str) -> str:
    """
    Fixes markdown code blocks.
    Example: '```\ncode\n```' becomes '```text\ncode\n```'
    """
    def replace(match: re.Match) -> str:
        language = match.group(1)
        if not language:
            return "```text\n"
        return f"```{language}\n"

    # Use the pre-compiled pattern
    return CODE_BLOCK_PATTERN.sub(replace, text)


def format_groq_response(content: Any) -> str:
    """
    Master formatter to clean LLM outputs before sending to the frontend.
    """
    normalized = normalize_text(content)
    if not normalized:
        return ""

    formatted = normalize_code_blocks(normalized)
    
    # Use pre-compiled patterns for whitespace cleanup
    formatted = TRAILING_WHITESPACE_PATTERN.sub("\n", formatted)
    formatted = EXTRA_NEWLINES_PATTERN.sub("\n\n", formatted)

    return formatted.strip()
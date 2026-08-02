"""Check which packages from requirements.txt are missing locally."""
import importlib
import subprocess
import sys

REQUIREMENTS = [
    "fastapi",
    "uvicorn",
    "groq",
    "chromadb",
    "google.genai",  # google-genai
    "pydantic",
    "email_validator",
    "dotenv",  # python-dotenv
    "slowapi",
    "httpx",
]

# Map our display name -> import name where they differ
DISPLAY = {
    "google.genai": "google-genai",
    "dotenv": "python-dotenv",
}

missing = []
for mod in REQUIREMENTS:
    try:
        importlib.import_module(mod)
    except ImportError:
        missing.append(DISPLAY.get(mod, mod))

if missing:
    print("MISSING:", ", ".join(missing))
    print()
    print("Install with:")
    print("  pip install " + " ".join(missing))
else:
    print("All requirements.txt packages are importable.")
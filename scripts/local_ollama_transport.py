"""Allow scanner tools to call only the local Ollama host endpoint."""
from urllib.parse import urlsplit


_ALLOWED_HOSTS = {"host.docker.internal", "localhost", "127.0.0.1"}


def local_ollama_url(value: str, endpoint: str) -> str:
    """Return a canonical local Ollama URL or reject external destinations."""
    parsed = urlsplit(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname is None
        or parsed.hostname.lower() not in _ALLOWED_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 11434)
        or parsed.path not in ("", "/", endpoint)
        or parsed.query
        or parsed.fragment
        or (endpoint and not endpoint.startswith("/"))
        or "?" in endpoint
        or "#" in endpoint
    ):
        raise ValueError("Only the local Ollama service is allowed")
    return f"http://{parsed.hostname.lower()}:11434{endpoint}"

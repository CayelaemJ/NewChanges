"""HTTP client restricted to local Ollama for repository security tooling."""
from http.client import HTTPConnection
from urllib.parse import urlsplit

_ALLOWED_HOSTS = {"localhost", "127.0.0.1", "host.docker.internal"}
_ALLOWED_PATHS = {"/api/generate", "/api/ps"}
_MAX_RESPONSE_BYTES = 16 * 1024 * 1024


def request_local_ollama(url, *, method, body=None, timeout=60):
    """Send only to the local Ollama API; reject arbitrary schemes and hosts."""
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid local Ollama URL") from exc

    if (
        parsed.scheme != "http"
        or parsed.hostname not in _ALLOWED_HOSTS
        or port not in (None, 11434)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in _ALLOWED_PATHS
        or (method == "POST" and parsed.path != "/api/generate")
        or (method == "GET" and parsed.path != "/api/ps")
        or method not in {"GET", "POST"}
        or (method == "POST" and not isinstance(body, bytes))
        or (method == "GET" and body is not None)
    ):
        raise ValueError("Only local Ollama generate and process endpoints are allowed")

    connection = HTTPConnection(parsed.hostname, port or 11434, timeout=timeout)
    try:
        headers = {"Content-Type": "application/json"} if method == "POST" else {}
        connection.request(method, parsed.path, body=body, headers=headers)
        response = connection.getresponse()
        payload = response.read(_MAX_RESPONSE_BYTES + 1)
        if len(payload) > _MAX_RESPONSE_BYTES:
            raise OSError("Local Ollama response exceeded the size limit")
        if response.status != 200:
            raise OSError(f"Local Ollama returned HTTP {response.status}")
        return payload
    finally:
        connection.close()

"""Allow scanner tools to call only the local Ollama host endpoint."""
from http.client import HTTPConnection
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


_ALLOWED_REQUESTS = {("POST", "/api/generate"), ("GET", "/api/ps")}
_MAX_RESPONSE_BYTES = 16 * 1024 * 1024

def request_local_ollama(url: str, *, method: str, body: bytes | None = None, timeout: float = 60) -> bytes:
    """Send a bounded request only to an allowlisted local Ollama endpoint."""
    parsed = urlsplit(url)
    if (method, parsed.path) not in _ALLOWED_REQUESTS:
        raise ValueError("Only local Ollama generate and process endpoints are allowed")
    canonical = local_ollama_url(url, parsed.path)
    target = urlsplit(canonical)
    if (method == "POST" and not isinstance(body, bytes)) or (method == "GET" and body is not None):
        raise ValueError("Invalid local Ollama request body")

    connection = HTTPConnection(target.hostname, 11434, timeout=timeout)
    try:
        headers = {"Content-Type": "application/json"} if method == "POST" else {}
        connection.request(method, target.path, body=body, headers=headers)
        response = connection.getresponse()
        payload = response.read(_MAX_RESPONSE_BYTES + 1)
        if len(payload) > _MAX_RESPONSE_BYTES:
            raise OSError("Local Ollama response exceeded the size limit")
        if response.status != 200:
            raise OSError(f"Local Ollama returned HTTP {response.status}")
        return payload
    finally:
        connection.close()

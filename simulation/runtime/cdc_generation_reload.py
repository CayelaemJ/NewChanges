"""Race-resistant dashboard reload protocol for notification-only CDC.

Framework-agnostic; backend adapter must enforce user/tenant access for
generation reads and view queries. This is not a subscription or HTTP endpoint.
"""


class GenerationChangedDuringRead(RuntimeError):
    """View never stabilized; caller must retry, not claim freshness."""


def consistent_view_reload(read_generation, read_view, *, attempts=3):
    """Double-check generation around each authoritative view query.

    read_generation and read_view must target the same source/feed/security
    scope. The backend must guarantee ordered/atomic feed invalidation commits.
    """
    if not callable(read_generation) or not callable(read_view):
        raise TypeError("Callbacks required")
    if type(attempts) is not int or not 1 <= attempts <= 5:
        raise ValueError("Bounded reload attempts required")
    for _ in range(attempts):
        before = read_generation()
        if type(before) is not int or before < 0:
            raise ValueError("Invalid initial feed generation")
        result = read_view()
        after = read_generation()
        if type(after) is not int or after < before:
            raise ValueError("Feed generation regressed or is invalid")
        if before == after:
            return {"data": result, "generation": after}
    raise GenerationChangedDuringRead(
        "Source changed during view reload; do not display stale-success state"
    )

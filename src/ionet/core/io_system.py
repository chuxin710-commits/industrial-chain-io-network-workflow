"""Validated, positive-output IO data with explicit accounting boundaries."""

from collections.abc import Iterable, Mapping
from copy import deepcopy
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray


def _ordered_sector_codes(sectors: Iterable[str], n: int) -> tuple[str, ...]:
    if sectors is None or isinstance(sectors, (str, bytes, set, frozenset, Mapping)):
        raise ValueError("sectors must be an ordered iterable of individual sector codes")
    try:
        codes = tuple(sectors)
    except TypeError as exc:
        raise ValueError("sectors must be an ordered iterable of individual sector codes") from exc
    if len(codes) != n:
        raise ValueError("sectors must have exactly one code per Z row and column")
    if any(not isinstance(code, str) or not code.strip() for code in codes):
        raise ValueError("sector codes must be nonempty strings")
    if len(set(codes)) != n:
        raise ValueError("sector codes must be unique")
    return codes


class IOSystem:
    """Hold supplier-row, buyer-column transactions without network filtering.

    ``y`` is optional and never inferred from ``x - Z.sum(axis=1)``. For a
    domestic transaction system, a row-balanced output-side closure generally
    includes domestic final uses, external exports and explicit adjustments.
    Those adjustments are not automatically legitimate demand-shock targets.
    Record the actual boundary in metadata, especially ``accounting_scope``
    and ``y_scope``. Unknown units and prices must not be guessed.

    This operational object requires positive output. A dataset adapter must
    handle zero-output raw nodes explicitly before constructing it.
    Ordered lists, tuples, NumPy label arrays and ordered generators are
    accepted; generator labels are consumed once into a stable tuple.
    """

    def __init__(
        self,
        Z: ArrayLike,
        x: ArrayLike,
        sectors: Iterable[str],
        y: ArrayLike | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        z_values = np.array(Z, dtype=float, copy=True)
        x_values = np.array(x, dtype=float, copy=True)
        if z_values.ndim != 2 or z_values.shape[0] != z_values.shape[1]:
            raise ValueError("Z must be a square two-dimensional matrix")
        n = z_values.shape[0]
        if n < 1:
            raise ValueError("Z must contain at least one sector")
        if x_values.ndim != 1 or x_values.shape != (n,):
            raise ValueError("x must be a one-dimensional vector aligned with Z")
        if not np.isfinite(z_values).all() or not np.isfinite(x_values).all():
            raise ValueError("Z and x must contain only finite values")
        if (z_values < 0).any():
            raise ValueError("Z must contain nonnegative transactions")
        if (x_values <= 0).any():
            raise ValueError("x must be strictly positive; handle raw zero-output nodes explicitly")
        sector_codes = _ordered_sector_codes(sectors, n)

        y_values = None
        if y is not None:
            y_values = np.array(y, dtype=float, copy=True)
            if y_values.ndim != 1 or y_values.shape != (n,):
                raise ValueError("y must be a one-dimensional vector aligned with Z")
            if not np.isfinite(y_values).all():
                raise ValueError("y must contain only finite values")
            y_values.setflags(write=False)
        if metadata is not None and not isinstance(metadata, Mapping):
            raise ValueError("metadata must be a mapping")
        metadata_values = deepcopy(dict(metadata) if metadata is not None else {})
        for key in ("amount_unit", "price_basis", "accounting_scope", "y_scope"):
            metadata_values.setdefault(key, "unknown")

        z_values.setflags(write=False)
        x_values.setflags(write=False)
        self.Z: NDArray[np.float64] = z_values
        self.x: NDArray[np.float64] = x_values
        self.y: NDArray[np.float64] | None = y_values
        self.sectors = sector_codes
        self.metadata = metadata_values

    def _validate_current_state(self) -> None:
        # Read-only NumPy arrays can be unlocked; recheck before scientific use.
        for name in ("Z", "x"):
            values = getattr(self, name)
            if not isinstance(values, np.ndarray) or values.dtype.kind not in "iuf":
                raise ValueError(f"current {name} must be a real numeric NumPy array")
            if not np.isfinite(values).all():
                raise ValueError(f"current {name} must contain only finite values")
        if self.Z.ndim != 2 or self.Z.shape[0] < 1 or self.Z.shape[0] != self.Z.shape[1]:
            raise ValueError("current Z must be a nonempty square matrix")
        n = self.Z.shape[0]
        if self.x.ndim != 1 or self.x.shape != (n,):
            raise ValueError("current x must be a one-dimensional vector aligned with Z")
        if (self.Z < 0).any() or (self.x <= 0).any():
            raise ValueError("current Z must be nonnegative and current x strictly positive")
        _ordered_sector_codes(self.sectors, n)

    @property
    def A(self) -> NDArray[np.float64]:
        """Return complete technical coefficients, retaining self-transactions."""
        self._validate_current_state()
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            coefficients = self.Z / self.x[None, :]
        if not np.isfinite(coefficients).all():
            raise ValueError("A contains nonfinite values after normalization")
        return coefficients

    @property
    def L(self) -> NDArray[np.float64]:
        """Return the productive Leontief inverse using a linear solve.

        Spectral radius below one is required but is not certification of data
        provenance, balance, price comparability or a shock mechanism.
        """
        coefficients = self.A
        radius = float(np.max(np.abs(np.linalg.eigvals(coefficients))))
        if not np.isfinite(radius) or radius >= 1:
            raise ValueError("Leontief inverse requires spectral radius rho(A) < 1")
        identity = np.eye(len(self.sectors))
        try:
            inverse = np.linalg.solve(identity - coefficients, identity)
        except np.linalg.LinAlgError as exc:
            raise ValueError("Leontief system is singular") from exc
        if not np.isfinite(inverse).all():
            raise ValueError("Leontief inverse contains nonfinite values")
        return inverse

    def row_balance(self, *, rtol: float = 1e-8, atol: float = 1e-8) -> bool:
        """Check x = Z 1 + explicit y, without inferring or modifying y.

        In domestic tables, y must cover the full output-side final-use
        boundary, including exports and any stated closure adjustments.
        """
        if self.y is None:
            raise ValueError("row_balance requires explicit y with its output-side accounting scope")
        self._validate_current_state()
        if not isinstance(self.y, np.ndarray) or self.y.dtype.kind not in "iuf":
            raise ValueError("current y must be a real numeric NumPy array")
        if self.y.ndim != 1 or self.y.shape != self.x.shape or not np.isfinite(self.y).all():
            raise ValueError("current y must be finite and aligned with Z")
        if not np.isfinite([rtol, atol]).all() or rtol < 0 or atol < 0:
            raise ValueError("row-balance tolerances must be finite and nonnegative")
        return bool(np.allclose(self.x, self.Z.sum(axis=1) + self.y, rtol=rtol, atol=atol))

    def to_network(self, matrix: str = "A", threshold: float = 0.0):
        """Build a separate network view without altering IO coefficients."""
        from ionet.network import build_network

        return build_network(self, matrix=matrix, threshold=threshold)

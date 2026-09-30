"""Experimental reusable IO/network core; no import-time experiments."""

from .core import IOSystem
from .network import NetworkSystem, build_network, structural_metrics

__version__ = "0.1.0.dev0"
__all__ = ["IOSystem", "NetworkSystem", "build_network", "structural_metrics"]


"""Configuration-driven entry point for the first reproducible slice."""

import argparse

from .experiment import run_experiment


def main():
    parser = argparse.ArgumentParser(prog="ionet")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Run an explicit synthetic IO/network experiment")
    run.add_argument("--config", required=True)
    run.add_argument("--output", required=True, help="New output directory; never overwritten")
    args = parser.parse_args()
    try:
        output = run_experiment(args.config, args.output)
    except (ValueError, FileExistsError, OSError) as exc:
        parser.exit(2, f"ionet: {exc}\n")
    print(f"Completed: {output}")


if __name__ == "__main__":
    main()


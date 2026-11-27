# Contributing

Fork this repository, push your changes to a branch in your fork, and open a pull request against `main`. Describe what changed and how you verified it. Run `python3 scripts/check.py` before opening the pull request. The checks need Python 3.12 or newer and Node.js 24 and run without a Freestyle account.

For a new view, include setup instructions, register it in `scripts/check.py`, and document the [host capabilities](docs/HOST_CONTRACT.md) it uses. Use the [public Studio API documentation](https://freestyle.audio/docs/) for standalone integrations. Include assets you created or have permission to redistribute, with any required license notices.

Use synthetic names, IDs, project data, and URLs in examples and tests. If an engine change is needed, open an Engine/API request with a sanitized example. Maintainers review changes before merging and review embedded host behavior before shipping a view in Freestyle.

# Freestyle Studio UIs

Seven browser-based studio views for the [Freestyle Studio API](https://freestyle.audio/docs/).
The standalone views serve their UI on your computer and connect to Freestyle for project data and audio.

| Studio | Directory | Local port |
| --- | --- | --- |
| Disabelton | `Disabelton` | 8083 |
| Illogic Amateur | `Illogic Amateur` | 8082 |
| Illogic Amateur Classic | `Illogic Amateur Classic` | 8084 |
| Street Band | `Street Band` | 8085 |
| Trashlab | `Trashlab` | 8086 |
| Vegetable Studio | `Vegetable Studio` | 8081 |
| Modesty | `modesty` | 8080 |

Use Python 3.12 or newer and Node.js 24 for development. From one of the app directories, run `python3 server.py --port PORT`, substituting the port above. Open `http://127.0.0.1:PORT/` and choose **Connect Freestyle** to work with your own project. Modesty's WebSocket client is listed in `modesty/requirements.txt`.

Run `python3 scripts/check.py` from the repository root to check every app offline. See [Contributing](CONTRIBUTING.md), the [host contract](docs/HOST_CONTRACT.md), and the [security policy](SECURITY.md).

## License

Freestyle-owned code is available under the [MIT License](LICENSE). Bundled third-party fonts retain their [respective licenses](THIRD_PARTY_NOTICES.md).

"""Run offline MIDI and standalone HTTP checks for each Studio UI."""
import ast
import http.client
import os
from pathlib import Path
import subprocess
import sys

APPS = (
    "Disabelton",
    "Illogic Amateur",
    "Illogic Amateur Classic",
    "Street Band",
    "Trashlab",
    "Vegetable Studio",
    "modesty",
)

ROOT = Path(__file__).resolve().parents[1]
SERVER_START = """
import server
with server.make_server(port=0) as app:
    print(app.server_port, flush=True)
    app.serve_forever()
"""


def request(port, path):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def check_server(app_directory):
    env = {**os.environ, "FREESTYLE_BASE": "http://127.0.0.1:1"}
    env.pop("FREESTYLE_ACCESS_TOKEN", None)
    with subprocess.Popen(
        [sys.executable, "-c", SERVER_START],
        cwd=app_directory,
        env=env,
        stdout=subprocess.PIPE,
        text=True,
    ) as server:
        try:
            port_line = server.stdout.readline()
            if not port_line:
                raise RuntimeError(f"{app_directory.name} server did not start")
            port = int(port_line)
            status, html = request(port, "/")
            if status != 200 or b"<html" not in html.lower():
                raise RuntimeError(f"{app_directory.name} did not serve its index")
            status, _ = request(port, "/app.js")
            if status != 200:
                raise RuntimeError(f"{app_directory.name} did not serve its JS entry point")
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


def main():
    for name in APPS:
        app = ROOT / name
        print(f"Checking {name}", flush=True)
        for path in sorted(app.rglob("*.py")):
            ast.parse(path.read_text(), filename=str(path))
        subprocess.run(["node", "--check", "app.js"], cwd=app, check=True)
        subprocess.run(["npm", "test"], cwd=app, check=True)
        check_server(app)


if __name__ == "__main__":
    main()

"""Run on macOS with a signed release ZIP and its matching MOLE_SIGNING_IDENTITY."""
import hashlib
import http.server
import json
import os
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


def run(*arguments):
    subprocess.run(arguments, check=True)


def digest(file):
    sha = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def app_processes(app):
    output = subprocess.check_output(["ps", "-ax", "-o", "pid=,comm="], text=True)
    executable = (app / "Contents/MacOS/Oasis").resolve()
    result = []
    for row in output.splitlines():
        pid, _, command = row.strip().partition(" ")
        if command.strip().endswith("/Contents/MacOS/Oasis") and Path(command.strip()).resolve() == executable:
            result.append(int(pid))
    return result


root = Path(__file__).resolve().parents[1]
archive = Path(sys.argv[1]).resolve()
version = re.fullmatch(r"Oasis-Wallpaper-v(\d+\.\d+\.\d+)-macOS-universal\.zip", archive.name).group(1)
identity = os.environ["MOLE_SIGNING_IDENTITY"]
sign = ["codesign", "--force", "--options", "runtime", "--timestamp=none", "--sign", identity]
with tempfile.TemporaryDirectory(prefix="oasis-wallpaper-update-test-") as temp:
    work = Path(temp).resolve()
    native = []
    for arch in ("arm64", "x86_64"):
        output = work / ("driver-" + arch)
        run("swiftc", "-parse-as-library", "-module-cache-path", work / ("cache-" + arch),
            "-target", arch + "-apple-macosx13.0", root / "App/Contents/Resources/OasisUpdaterCore.swift",
            root / "Wallpaper/OasisWallpaperUpdater.swift", root / "Wallpaper/OasisWallpaperUpdateInstall.swift",
            root / "Tests/wallpaper-update-driver.swift", "-o", output)
        native.append(output)
    executable = work / "driver"
    run("lipo", "-create", *native, "-output", executable)

    def fixture(parent, release, fail=False):
        bundle = parent / "Oasis Wallpaper.app"
        macos = bundle / "Contents/MacOS"
        resources = bundle / "Contents/Resources"
        macos.mkdir(parents=True)
        resources.mkdir()
        shutil.copy2(executable, macos / "Oasis")
        shutil.copy2(executable, macos / "node")
        run(*sign, macos / "node")
        (resources / "OasisWallpaperServer.mjs").write_text("// fixture\n")
        info = plistlib.loads((root / "Wallpaper/Info.plist").read_bytes())
        info.update(CFBundleShortVersionString=release, WallpaperTestFailLaunch=fail)
        (bundle / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
        run(*sign, bundle)
        return bundle

    broken = work / "broken.zip"
    run("ditto", "-c", "-k", "--keepParent", fixture(work / "broken", version, fail=True), broken)
    old = fixture(work / "template", "0.0.1")
    for case in ("current", "checksum", "rollback", "upgrade"):
        directory = work / case
        directory.mkdir()
        app = directory / old.name
        run("ditto", old, app)
        trace = directory / "trace"
        trace.touch()
        data = directory / "library"
        data.mkdir()
        marker = data / "user-wallpaper"
        marker.write_bytes(b"existing user content")
        file = archive if case == "upgrade" else broken
        release = "0.0.1" if case == "current" else version
        name = f"Oasis-Wallpaper-v{release}-macOS-universal.zip"
        checksum = "0" * 64 if case == "checksum" else digest(file)
        requests = []

        class Feed(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requests.append(self.path)
                if self.path == "/releases":
                    payload = json.dumps([dict(tag_name="v" + release, draft=False, prerelease=False,
                        assets=[dict(name=name, state="uploaded", id=1, size=file.stat().st_size,
                                     digest="sha256:" + checksum)])]).encode()
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                elif self.path == f"/v{release}/{name}":
                    self.send_response(200)
                    self.send_header("Content-Length", str(file.stat().st_size))
                    self.end_headers()
                    with file.open("rb") as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b""):
                            self.wfile.write(block)
                            if case == "upgrade":
                                time.sleep(0.008)
                else:
                    self.send_error(404)

        with http.server.ThreadingHTTPServer(("127.0.0.1", 0), Feed) as server:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            env = dict(os.environ, WALLPAPER_TEST_FEED=f"http://127.0.0.1:{server.server_port}",
                       WALLPAPER_TEST_LOG=str(trace), OASIS_WALLPAPER_DATA=str(data))
            process = subprocess.Popen([app / "Contents/MacOS/Oasis"], env=env)
            try:
                process.wait(timeout=100)
                for _ in range(450):
                    log = trace.read_text()
                    actual = plistlib.loads((app / "Contents/Info.plist").read_bytes())["CFBundleShortVersionString"]
                    clean = not list(directory.glob(".Oasis-Wallpaper-update-*"))
                    if case == "current" and "current " in log and clean: break
                    if case == "checksum" and "驗證失敗" in log and actual == "0.0.1" and clean: break
                    if case == "rollback" and "rolled back and reopened" in log and actual == "0.0.1" and clean: break
                    if case == "upgrade" and actual == version and clean and app_processes(app): break
                    time.sleep(0.25)
                else:
                    raise AssertionError(f"{case} failed (installed {actual}):\n{log}")
                assert requests.count("/releases") == 1, requests
                assert len(requests) == (1 if case == "current" else 2), requests
                assert marker.read_bytes() == b"existing user content"
                if case == "upgrade":
                    assert "installing " in log and re.search(r"downloading 0\.[1-9]", log), log
                print("PASS", case, flush=True)
            finally:
                server.shutdown()
                # Close only the disposable fixture, including a freshly relaunched candidate.
                for pid in app_processes(app):
                    try: os.kill(pid, signal.SIGTERM)
                    except ProcessLookupError: pass

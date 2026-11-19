#!/usr/bin/env python3
"""Verify all three WXT release archives before publishing them in GitHub."""
import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]


def verify(part: str) -> None:
    filename = f"forum-article-saver-{version}-{part}.zip"
    path = root / "dist" / filename
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"Missing or empty: {path}")
    with ZipFile(path) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise RuntimeError(f"{filename}: corrupt member {corrupt}")
        names = set(archive.namelist())
        if part == "sources":
            required = {"package.json", "package-lock.json", "BUILD.md", "wxt.config.ts"}
            missing = required - names
            if missing:
                raise RuntimeError(f"{filename}: missing source files: {sorted(missing)}")
            metadata = json.loads(archive.read("package.json"))
        else:
            if "manifest.json" not in names:
                raise RuntimeError(f"{filename}: missing manifest.json")
            metadata = json.loads(archive.read("manifest.json"))
            if not any(name.endswith(".js") for name in names):
                raise RuntimeError(f"{filename}: missing JavaScript bundles")
        if part != "sources":
            # Chrome Web Store validates the manifest description at upload time.
            # Count UTF-16 units (the same as JavaScript String.length).
            description = metadata.get("description", "")
            desc_length = len(description.encode("utf-16-le")) // 2
            if not description.strip() or desc_length > 132:
                raise RuntimeError(
                    f"{filename}: manifest.description has {desc_length} characters (max 132)"
                )
            name = metadata.get("name", "")
            if not name or len(name.encode("utf-16-le")) // 2 > 45:
                raise RuntimeError(f"{filename}: invalid manifest.name")
        if metadata.get("version") != version:
            raise RuntimeError(
                f"{filename}: bundled version {metadata.get('version')!r} != {version!r}"
            )
        print(f"OK {filename}: {path.stat().st_size} bytes, {len(names)} members")


for part_name in ("chrome", "firefox", "sources"):
    verify(part_name)

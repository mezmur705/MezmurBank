"""Reorganizes lyrics files (from import_telegram_export.py's songs/ folder) into a
<Singer>/<Title>.txt tree, deriving singer and title from each file's own header line(s).

This export used at least half a dozen different header conventions across the years - there
is no single reliable pattern. extract_singer_title() tries several, in order of confidence,
and falls back to "UnknownSinger" (matching clean_telegram_media.py's existing convention) with
the raw header text as the title when nothing recognizable matches. Originals are left untouched;
this only ever writes into the new destination tree.

Usage: python organize_lyrics_by_singer.py [source_dir] [destination_dir]
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

DEFAULT_SOURCE = Path(r"H:\My Drive\backup\Telegram\lyrics_manual_import\songs")
DEFAULT_DESTINATION = Path(r"H:\My Drive\backup\Telegram\lyrics_manual_import_songs")

UNKNOWN_SINGER = "UnknownSinger"
ETHIOPIC_RE = re.compile(r'[ሀ-፿ᎀ-᎟ⶀ-⷟꬀-꬯]')
URL_RE = re.compile(r'\(?https?://\S+\)?')
MEZMUR_LYRICS_PREFIX_RE = re.compile(r'^(?:Mezmur\s*(?:🎼)?\s*Lyrics|<unknown>)\s*[–-]\s*(.+)$', re.I)
QUOTED_TITLE_RE = re.compile(r'^"([^"]+)"\s*.*?[-–]\s*([^()]+)$')
BY_RE = re.compile(r'^(.+?)\s+by\s+(.+)$', re.I)
COLON_JOIN_RE = re.compile(r'^(.+?):\s*_?(.+)$')
DASH_JOIN_RE = re.compile(r'^(.+?)\s*[-–]\s*(.+)$')
SINGER_LABEL_RE = re.compile(r'^ዘማሪት?[\s:]+(.+)$')


def is_tag_line(line: str) -> bool:
    """Matches "#Title", "🎼#Title_With_Underscores", "🎤#Singer", or a "Title :"/"Artist :" label."""
    return bool(re.match(r"^[^\w#]{0,4}#", line)) or bool(re.match(r"(?i)^\s*(?:title|artist)\s*:", line))


def clean_tag_line(line: str) -> str:
    line = re.sub(r"(?i)^\s*(?:title|artist)\s*:\s*", "", line)
    line = re.sub(r"^[^\w#]{0,4}#", "", line)
    line = line.replace("_", " ").replace(":", " ")
    return re.sub(r"\s+", " ", line).strip()


def sanitize_name(s: str, max_len: int = 80) -> str:
    """Filesystem-safe short name derived from s, keeping spaces (no underscores)."""
    if not s:
        return ""
    safe = "".join(ch if ch.isalnum() or ch in ("-", " ", "'") else " " for ch in s.strip())
    return re.sub(r' {2,}', ' ', safe).strip()[:max_len]


def strip_wrapping_brackets(s: str) -> str:
    s = s.strip()
    if s.startswith('[') and s.endswith(']'):
        return s[1:-1].strip()
    return s


def split_by_script(core: str) -> tuple[str, str] | None:
    """Many headers have no delimiter at all: a Latin-script singer name runs straight into an
    Amharic-script title, e.g. "Bereket Tesfaye ከሚጠፉት Kemitefut". Splits right before the first
    Ethiopic word, if there is one after at least one Latin word."""
    words = core.split()
    first_amharic = next((i for i, w in enumerate(words) if ETHIOPIC_RE.search(w)), None)
    if first_amharic is None or first_amharic == 0:
        return None
    singer = sanitize_name(" ".join(words[:first_amharic]), 60)
    title = sanitize_name(" ".join(words[first_amharic:]))
    if not singer or not title:
        return None
    return singer, title


def extract_singer_title(lines: list[str]) -> tuple[str, str, str]:
    """Returns (singer, title, method) - method names which heuristic fired, for the report."""
    non_blank = [line for line in lines if line.strip()]
    if not non_blank:
        return UNKNOWN_SINGER, "Untitled", "empty"

    if len(non_blank) >= 2 and is_tag_line(non_blank[0]) and is_tag_line(non_blank[1]):
        title = clean_tag_line(non_blank[0])
        singer = clean_tag_line(non_blank[1])
        if title:
            return (sanitize_name(singer, 60) or UNKNOWN_SINGER), (sanitize_name(title) or "Untitled"), "tag-pair"

    # "ዘማሪ <Name>" / "ዘማሪት <Name>" ("Singer <Name>") - a singer-only line with no title at all;
    # the actual title is just the first lyric line that follows.
    label_match = SINGER_LABEL_RE.match(non_blank[0].strip())
    if label_match:
        singer = sanitize_name(label_match.group(1), 60)
        title = sanitize_name(non_blank[1]) if len(non_blank) > 1 else ""
        if singer:
            return singer, (title or "Untitled"), "singer-label"

    core = strip_wrapping_brackets(non_blank[0])
    core = URL_RE.sub('', core).strip()
    core = re.sub(r'\.mp3\b', '', core, flags=re.I).strip(' -:')
    if not core:
        return UNKNOWN_SINGER, "Untitled", "empty-header"

    match = MEZMUR_LYRICS_PREFIX_RE.match(core)
    if match:
        rest = match.group(1).strip()
        if '|' in rest:
            left, right = rest.split('|', 1)
            return (sanitize_name(left, 60) or UNKNOWN_SINGER), (sanitize_name(right) or "Untitled"), "lyrics-prefix-pipe"
        tokens = [t for t in rest.replace('__', '_').split('_') if t]
        if len(tokens) >= 2:
            singer = sanitize_name(f"{tokens[0]} {tokens[1]}", 60)
            title = sanitize_name(" ".join(tokens[2:]) or tokens[1])
            return (singer or UNKNOWN_SINGER), (title or "Untitled"), "lyrics-prefix-underscore"
        plain = rest.replace('_', ' ')
        split = split_by_script(plain)
        if split:
            return split[0], split[1], "lyrics-prefix-script-split"
        return UNKNOWN_SINGER, (sanitize_name(plain) or "Untitled"), "lyrics-prefix-plain"

    if '||' in core:
        left, right = core.split('||', 1)
        return (sanitize_name(right, 60) or UNKNOWN_SINGER), (sanitize_name(left) or "Untitled"), "double-pipe"
    if '|' in core:
        left, right = core.split('|', 1)
        return (sanitize_name(left, 60) or UNKNOWN_SINGER), (sanitize_name(right) or "Untitled"), "pipe"

    match = QUOTED_TITLE_RE.match(core)
    if match:
        return (sanitize_name(match.group(2), 60) or UNKNOWN_SINGER), (sanitize_name(match.group(1)) or "Untitled"), "quoted-title"

    match = BY_RE.match(core)
    if match:
        return (sanitize_name(match.group(2), 60) or UNKNOWN_SINGER), (sanitize_name(match.group(1)) or "Untitled"), "title-by-singer"

    match = COLON_JOIN_RE.match(core)
    if match and len(match.group(2).split()) <= 4:
        singer = sanitize_name(match.group(2).replace('_', ' '), 60)
        title = sanitize_name(match.group(1).replace('_', ' '))
        return (singer or UNKNOWN_SINGER), (title or "Untitled"), "colon-join"

    match = DASH_JOIN_RE.match(core)
    if match:
        return (sanitize_name(match.group(1), 60) or UNKNOWN_SINGER), (sanitize_name(match.group(2)) or "Untitled"), "dash-join"

    split = split_by_script(core)
    if split:
        return split[0], split[1], "script-split"

    return UNKNOWN_SINGER, (sanitize_name(core) or "Untitled"), "no-match"


def process(source: Path, destination: Path) -> None:
    if not source.is_dir():
        raise FileNotFoundError(f"Source directory does not exist: {source}")

    text_files = sorted(path for path in source.iterdir() if path.is_file() and path.suffix.lower() == ".txt")
    total = len(text_files)
    print(f"Found {total} files in {source}", flush=True)

    used_names: dict[Path, int] = {}
    method_counts: dict[str, int] = {}
    report_lines: list[str] = []
    unknown_singer_count = 0

    for index, source_file in enumerate(text_files, start=1):
        content = source_file.read_text(encoding="utf-8", errors="replace")
        singer, title, method = extract_singer_title(content.splitlines())
        method_counts[method] = method_counts.get(method, 0) + 1
        if singer == UNKNOWN_SINGER:
            unknown_singer_count += 1

        singer_dir = destination / (singer or UNKNOWN_SINGER)
        singer_dir.mkdir(parents=True, exist_ok=True)
        base_path = singer_dir / f"{title or 'Untitled'}.txt"
        occurrence = used_names.get(base_path, 0)
        used_names[base_path] = occurrence + 1
        target_path = base_path if occurrence == 0 else singer_dir / f"{title} ({occurrence}).txt"

        target_path.write_text(content, encoding="utf-8")
        report_lines.append(f"[{method}] {source_file.name} -> {singer}/{target_path.name}")

        if index % 100 == 0:
            print(f"[{index}/{total}] processed", flush=True)

    report_text = [
        "Singer/title organization report",
        f"Source: {source}",
        f"Destination: {destination}",
        f"Total files: {total}",
        f"Files with no recognizable singer (filed under {UNKNOWN_SINGER}): {unknown_singer_count}",
        "",
        "Extraction method counts:",
        *(f"  {method}: {count}" for method, count in sorted(method_counts.items(), key=lambda kv: -kv[1])),
        "",
        "Per-file results:",
        *report_lines,
    ]
    (destination / "organize_report.txt").write_text("\n".join(report_text), encoding="utf-8")

    singer_dirs = sorted(p.name for p in destination.iterdir() if p.is_dir())
    print(f"\nWrote {total} files across {len(singer_dirs)} singer folders in {destination}")
    print(f"Unknown singer: {unknown_singer_count} ({unknown_singer_count * 100 // max(total, 1)}%)")
    for method, count in sorted(method_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {method}: {count}")
    print(f"Report: {destination / 'organize_report.txt'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Organize lyrics files into <Singer>/<Title>.txt.")
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("destination", nargs="?", type=Path, default=DEFAULT_DESTINATION)
    args = parser.parse_args()
    process(args.source, args.destination)


if __name__ == "__main__":
    main()

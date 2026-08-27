"""Splits a Telegram Desktop chat export (one big .txt file) into one lyrics file per song.

Message boundaries look like:
    [30.08.2019 08:11] Mezmur 🎼 Lyrics: <first line of the message>
    <more lines...>
    [30.08.2019 13:27] Mezmur 🎼 Lyrics: <next message>
    ...
Everything from a "[DD.MM.YYYY HH:MM] Sender:" line up to (but not including) the next such
line belongs to one message. A reply message's body opens with a "> quoted text" line that
just echoes the message it replied to - that line is dropped, not treated as content.

Not every message is a song: this channel also has photo/video announcements, sermon-style
text posts, and (in later years) crypto/airdrop spam. Since there is no reliable way to
tell a short devotional post from a song by text alone, messages are put into three buckets
by simple heuristics rather than silently discarded:
  - songs/   likely real lyrics (several short lines, often with "(Nx)" repeat markers)
  - review/  everything else with enough text to be uncertain about - check by hand
  - (spam and near-empty messages are logged in the report but not saved as files)

Usage: python import_telegram_export.py [source.txt] [destination_dir]
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

DEFAULT_SOURCE = Path(r"H:\My Drive\backup\Python\Telegram_Importer\Mezmur_Lyrics.txt")
DEFAULT_DESTINATION = Path(r"H:\My Drive\backup\Telegram\lyrics_manual_import")

HEADER_RE = re.compile(r'^\[(\d{2}\.\d{2}\.\d{4}) (\d{2}:\d{2})\] (.+?): ?(.*)$')
QUOTE_LINE_RE = re.compile(r'^>\s?')
URL_RE = re.compile(r'\(?https?://\S+\)?')
REPEAT_MARKER_RE = re.compile(r'\(\s*[0-9\u1369-\u137c]+\s*[xX×]\s*\)')

# Terms seen in the crypto/airdrop spam that started appearing in this channel from ~2024 on.
# From mid-2024 the channel also started appending a crypto-bot referral link as a "share" footer
# to EVERY post, songs included - so bot names/URL params can't be used as spam signals; they show
# up on real songs too. Only readable promotional wording (checked after stripping URLs) counts.
SPAM_KEYWORDS = [
    'airdrop', 'binance', 'moonbix', 'notcoin', 'tomarket', 'timebucks', 'kyc', 'staking',
    'usdt', 'sign up', 'referral code', 'invest', 'invite', 'claim', 'verified', 'stake',
]


def parse_messages(raw_text: str) -> list[dict]:
    messages: list[dict] = []
    current: dict | None = None

    for line in raw_text.splitlines():
        match = HEADER_RE.match(line)
        if match:
            if current:
                messages.append(current)
            date, time, sender, first_line = match.groups()
            current = {"date": date, "time": time, "sender": sender, "lines": [first_line] if first_line else []}
        elif current is not None:
            current["lines"].append(line)

    if current:
        messages.append(current)
    return messages


def sanitize_name(s: str) -> str:
    """Filesystem-safe short name derived from s, keeping spaces (no underscores)."""
    if not s:
        return "untitled"
    safe = "".join(ch if ch.isalnum() or ch in ("-", " ") else "" for ch in s.strip())
    return re.sub(r' {2,}', ' ', safe).strip()[:80] or "untitled"


def is_spam(non_blank_lines: list[str]) -> bool:
    # Strip URLs first: bot names and tracking params live inside the shared footer link on
    # every post (real songs included) and must not count as spam evidence on their own.
    text_without_urls = URL_RE.sub('', "\n".join(non_blank_lines)).lower()
    return any(keyword in text_without_urls for keyword in SPAM_KEYWORDS)


def classify(non_blank_lines: list[str]) -> str:
    if len(non_blank_lines) < 3:
        return "skipped-short"
    if is_spam(non_blank_lines):
        return "skipped-spam"

    avg_len = sum(len(line) for line in non_blank_lines) / len(non_blank_lines)
    has_repeat_marker = any(REPEAT_MARKER_RE.search(line) for line in non_blank_lines)
    if avg_len > 70 and not has_repeat_marker and len(non_blank_lines) < 15:
        return "review"
    return "song"


def build_title(first_line: str) -> str:
    title = URL_RE.sub('', first_line).strip(' "\'-:')
    return sanitize_name(title)


def process(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Source file does not exist: {source}")

    raw_text = source.read_text(encoding="utf-8", errors="replace")
    messages = parse_messages(raw_text)
    total = len(messages)
    print(f"Parsed {total} messages from {source}", flush=True)

    songs_dir = destination / "songs"
    review_dir = destination / "review"
    songs_dir.mkdir(parents=True, exist_ok=True)
    review_dir.mkdir(parents=True, exist_ok=True)

    counts = {"song": 0, "review": 0, "skipped-short": 0, "skipped-spam": 0}
    used_names: dict[str, int] = {}
    skipped_log: list[str] = []

    for index, message in enumerate(messages, start=1):
        lines = list(message["lines"])
        if lines and QUOTE_LINE_RE.match(lines[0]):
            lines = lines[1:]

        non_blank = [line for line in lines if line.strip()]
        category = classify(non_blank)
        counts[category] += 1

        first_line = non_blank[0] if non_blank else ""
        stamp = f"{message['date'].replace('.', '')}-{message['time'].replace(':', '')}"

        if category in ("skipped-short", "skipped-spam"):
            skipped_log.append(f"[{category}] {stamp} {message['sender']}: {first_line[:100]}")
            continue

        title = build_title(first_line)
        base_name = f"{title}-{stamp}"
        occurrence = used_names.get(base_name, 0)
        used_names[base_name] = occurrence + 1
        file_name = f"{base_name}.txt" if occurrence == 0 else f"{base_name}-{occurrence}.txt"

        target_dir = songs_dir if category == "song" else review_dir
        (target_dir / file_name).write_text("\n".join(lines).strip("\n") + "\n", encoding="utf-8")

        if index % 100 == 0:
            print(f"[{index}/{total}] processed", flush=True)

    report_lines = [
        "Telegram export import report",
        f"Source: {source}",
        f"Destination: {destination}",
        f"Total messages: {total}",
        f"Saved as songs: {counts['song']}",
        f"Saved for review: {counts['review']}",
        f"Skipped (too short): {counts['skipped-short']}",
        f"Skipped (spam): {counts['skipped-spam']}",
        "",
        "Skipped messages (for spot-checking nothing real was dropped):",
        *skipped_log,
        "",
    ]
    (destination / "import_report.txt").write_text("\n".join(report_lines), encoding="utf-8")

    print(f"\nSaved {counts['song']} to {songs_dir}")
    print(f"Saved {counts['review']} to {review_dir} (check these by hand)")
    print(f"Skipped {counts['skipped-short']} too-short and {counts['skipped-spam']} spam messages")
    print(f"Report: {destination / 'import_report.txt'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Split a Telegram chat export into one lyrics file per song.")
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("destination", nargs="?", type=Path, default=DEFAULT_DESTINATION)
    args = parser.parse_args()
    process(args.source, args.destination)


if __name__ == "__main__":
    main()

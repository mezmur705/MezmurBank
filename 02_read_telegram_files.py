from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_MEDIA_DIR = Path(r"H:\My Drive\backup\Telegram\media")


def read_media_directory(media_dir: Path, text_only: bool = False) -> None:
    if not media_dir.is_dir():
        raise FileNotFoundError(f"Media directory does not exist: {media_dir}")

    files = sorted(path for path in media_dir.rglob("*") if path.is_file())
    text_files = [path for path in files if path.suffix.lower() == ".txt"]
    audio_files = [path for path in files if path.suffix.lower() == ".mp3"]

    print(f"Media directory: {media_dir}")
    print(f"Files: {len(files)} | MP3: {len(audio_files)} | TXT: {len(text_files)}")

    if not text_only:
        print("\nAudio files:")
        for audio_file in audio_files:
            size_mb = audio_file.stat().st_size / (1024 * 1024)
            print(f"- {audio_file.relative_to(media_dir)} ({size_mb:.2f} MB)")

    print("\nText files:")
    for text_file in text_files:
        print(f"\n===== {text_file.relative_to(media_dir)} =====")
        content = text_file.read_text(encoding="utf-8", errors="replace")
        print(content, end="" if content.endswith("\n") else "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Read Telegram media and lyric files.")
    parser.add_argument(
        "media_dir",
        nargs="?",
        type=Path,
        default=DEFAULT_MEDIA_DIR,
        help=f"Media directory (default: {DEFAULT_MEDIA_DIR})",
    )
    parser.add_argument(
        "--text-only",
        action="store_true",
        help="Skip the MP3 inventory and print only text files.",
    )
    args = parser.parse_args()
    read_media_directory(args.media_dir, text_only=args.text_only)


if __name__ == "__main__":
    main()
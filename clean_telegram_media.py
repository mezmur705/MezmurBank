from __future__ import annotations

import argparse
import re
from pathlib import Path


DEFAULT_SOURCE = Path(r"H:\My Drive\backup\Telegram\lyrics")
DEFAULT_DESTINATION = Path(r"H:\My Drive\backup\Telegram\lyrics_clean")
UNKNOWN_SINGER = "UnknownSinger"

FIDEL = {
    "ሀ": "he", "ሁ": "hu", "ሂ": "hi", "ሃ": "ha", "ሄ": "he", "ህ": "h", "ሆ": "ho",
    "ለ": "le", "ሉ": "lu", "ሊ": "li", "ላ": "la", "ሌ": "le", "ል": "l", "ሎ": "lo",
    "ሐ": "he", "ሑ": "hu", "ሒ": "hi", "ሓ": "ha", "ሔ": "he", "ሕ": "h", "ሖ": "ho",
    "መ": "me", "ሙ": "mu", "ሚ": "mi", "ማ": "ma", "ሜ": "me", "ም": "m", "ሞ": "mo",
    "ሠ": "sa", "ሡ": "su", "ሢ": "si", "ሣ": "sa", "ሤ": "se", "ሥ": "s", "ሦ": "so",
    "ረ": "re", "ሩ": "ru", "ሪ": "ri", "ራ": "ra", "ሬ": "re", "ር": "r", "ሮ": "ro",
    "ሰ": "se", "ሱ": "su", "ሲ": "si", "ሳ": "sa", "ሴ": "se", "ስ": "s", "ሶ": "so",
    "ሸ": "she", "ሹ": "shu", "ሺ": "shi", "ሻ": "sha", "ሼ": "she", "ሽ": "sh", "ሾ": "sho",
    "ቀ": "qa", "ቁ": "qu", "ቂ": "qi", "ቃ": "qa", "ቄ": "qe", "ቅ": "q", "ቆ": "qo",
    "በ": "be", "ቡ": "bu", "ቢ": "bi", "ባ": "ba", "ቤ": "be", "ብ": "b", "ቦ": "bo",
    "ተ": "te", "ቱ": "tu", "ቲ": "ti", "ታ": "ta", "ቴ": "te", "ት": "t", "ቶ": "to",
    "ቸ": "che", "ቹ": "chu", "ቺ": "chi", "ቻ": "cha", "ቼ": "che", "ች": "ch", "ቾ": "cho",
    "ነ": "ne", "ኑ": "nu", "ኒ": "ni", "ና": "na", "ኔ": "ne", "ን": "n", "ኖ": "no",
    "ኘ": "nga", "ኙ": "ngu", "ኚ": "ngi", "ኛ": "nga", "ኜ": "nge", "ኝ": "ng", "ኞ": "ngo",
    "አ": "a", "ኡ": "u", "ኢ": "i", "ኣ": "a", "ኤ": "e", "እ": "e", "ኦ": "o",
    "ከ": "ke", "ኩ": "ku", "ኪ": "ki", "ካ": "ka", "ኬ": "ke", "ክ": "k", "ኮ": "ko",
    "ኸ": "khe", "ኹ": "khu", "ኺ": "khi", "ኻ": "kha", "ኼ": "khe", "ኽ": "kh", "ኾ": "kho",
    "ወ": "we", "ዉ": "wu", "ዊ": "wi", "ዋ": "wa", "ዌ": "we", "ው": "w", "ዎ": "wo",
    "ዐ": "a", "ዑ": "u", "ዒ": "i", "ዓ": "a", "ዔ": "e", "ዕ": "e", "ዖ": "o",
    "ዘ": "ze", "ዙ": "zu", "ዚ": "zi", "ዛ": "za", "ዜ": "ze", "ዝ": "z", "ዞ": "zo",
    "ዠ": "zhe", "ዡ": "zhu", "ዢ": "zhi", "ዣ": "zha", "ዤ": "zhe", "ዥ": "zh", "ዦ": "zho",
    "የ": "ye", "ዩ": "yu", "ዪ": "yi", "ያ": "ya", "ዬ": "ye", "ይ": "y", "ዮ": "yo",
    "ደ": "de", "ዱ": "du", "ዲ": "di", "ዳ": "da", "ዴ": "de", "ድ": "d", "ዶ": "do",
    "ጀ": "je", "ጁ": "ju", "ጂ": "ji", "ጃ": "ja", "ጄ": "je", "ጅ": "j", "ጆ": "jo",
    "ገ": "ge", "ጉ": "gu", "ጊ": "gi", "ጋ": "ga", "ጌ": "ge", "ግ": "g", "ጎ": "go",
    "ጠ": "te", "ጡ": "tu", "ጢ": "ti", "ጣ": "ta", "ጤ": "te", "ጥ": "t", "ጦ": "to",
    "ጨ": "tshe", "ጩ": "tshu", "ጪ": "tshi", "ጫ": "tsha", "ጬ": "tshe", "ጭ": "tsh", "ጮ": "tsho",
    "ጰ": "pe", "ጱ": "pu", "ጲ": "pi", "ጳ": "pa", "ጴ": "pe", "ጵ": "p", "ጶ": "po",
    "ጸ": "tse", "ጹ": "tsu", "ጺ": "tsi", "ጻ": "tsa", "ጼ": "tse", "ጽ": "ts", "ጾ": "tso",
    "ፀ": "tse", "ፁ": "tsu", "ፂ": "tsi", "ፃ": "tsa", "ፄ": "tse", "ፅ": "ts", "ፆ": "tso",
    "ፈ": "fe", "ፉ": "fu", "ፊ": "fi", "ፋ": "fa", "ፌ": "fe", "ፍ": "f", "ፎ": "fo",
    "ፐ": "pe", "ፑ": "pu", "ፒ": "pi", "ፓ": "pa", "ፔ": "pe", "ፕ": "p", "ፖ": "po",
    "።": ".", "፣": ",", "፤": ";", "፥": ":", "፦": "-", "፧": "?", "፨": "::", "፠": ".", "፡": " ",
}


def transliterate(value: str) -> str:
    return "".join(FIDEL.get(character, character) for character in value)


def clean_name(value: str) -> str:
    value = transliterate(value).replace("_", " ")
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"[^A-Za-z0-9 .()'-]+", "", value)
    return value or "untitled"


def is_tag_line(line: str) -> bool:
    """Matches "#Title", "🎼#Title_With_Underscores", "🎤#Singer", or a "Title :"/"Artist :" label."""
    return bool(re.match(r"^[^\w#]{0,4}#", line)) or bool(re.match(r"(?i)^\s*(?:title|artist)\s*:", line))


def clean_tag_line(line: str) -> str:
    line = re.sub(r"(?i)^\s*(?:title|artist)\s*:\s*", "", line)
    line = re.sub(r"^[^\w#]{0,4}#", "", line)
    line = line.replace("_", " ").replace(":", " ")
    return re.sub(r"\s+", " ", line).strip()


def extract_title_artist(text: str) -> tuple[str, str]:
    """Pulls the title from the first non-blank line and the singer from the second, when tagged.

    Lyrics files from Read_Telegram_channel.py open with a "#Title" (optionally emoji-prefixed)
    line and, when present, a "#Singer" line right after - see is_tag_line/clean_tag_line.
    """
    non_blank = [line.strip() for line in text.splitlines() if line.strip()]
    if not non_blank:
        return "", ""
    title = clean_tag_line(non_blank[0]) if is_tag_line(non_blank[0]) else non_blank[0]
    artist = clean_tag_line(non_blank[1]) if len(non_blank) > 1 and is_tag_line(non_blank[1]) else ""
    return title, artist


def remove_extra_blank_lines(text: str) -> str:
    """
    Removes more than two sequential blank lines and reduces them to just 1 blank lines.

    Args:
        text (str): The input text with potential extra blank lines.

    Returns:
        str: The cleaned text with no more than two sequential blank lines.
    """

    lines = text.splitlines()
    cleaned_lines = []
    blank_count = 0

    for line in lines:
        if line.strip() == "":  # Check if the line is blank
            blank_count += 1
            if blank_count < 2:  # Allow up to one blank lines
                cleaned_lines.append(line)
        else:
            blank_count = 0  # Reset the blank line counter
            cleaned_lines.append(line)

    return "\n".join(cleaned_lines)


def clean_lyrics_text(text: str) -> str:
    amharic_to_arabic = {
        '፪': '2', '፫': '3', '፬': '4', '፭': '5',
        '፮': '6', '፯': '7', '፰': '8', '፱': '9'
    }

    for amharic, arabic in amharic_to_arabic.items():
        text = text.replace(amharic, arabic)

    patterns_to_remove = [
        r'አዝ፦ ', r'አዝ:-', r'አዝ:- ', r'አዝ', r'አዝ - ', r'\([አዝ]\)',
        r'//', r'/(\d+)', r'\(x(\d+)\)', r'[:፡፤፡፣፦።፥{}]',
        r'<pre><br />|</pre>', r'{{Classic', r'</poem>', r'}}',
        r'🔊', r'@Protestant_Mezmur', r'🎼', r'🎺', r'🎷', r'🎸'
    ]

    for pattern in patterns_to_remove:
        text = re.sub(pattern, ' ', text)

    text = re.sub(r' {2,}', ' ', text).strip()

    lines = text.splitlines()
    cleaned_lines = []

    for line in lines:
        line = line.strip()
        if '#' in line or re.match(r"(?i)^(?:title|artist)\s*:", line):
            continue

        cleaned_lines.append(f" {line}")

    cleaned_text = "\n".join(cleaned_lines)  # Join lines after cleaning
    cleaned_text = remove_extra_blank_lines(cleaned_text)  # Remove extra blank lines
    return cleaned_text


def process(source: Path, destination: Path) -> None:
    if not source.is_dir():
        raise FileNotFoundError(f"Source directory does not exist: {source}")
    destination.mkdir(parents=True, exist_ok=True)
    report = destination / "cleaning_report.txt"
    missing_artist: list[str] = []
    copied = 0

    text_files = sorted(path for path in source.iterdir() if path.is_file() and path.suffix.lower() == ".txt")
    total_files = len(text_files)

    for file_index, source_file in enumerate(text_files, start=1):
        print(f"[{file_index}/{total_files}] {source_file.name}", flush=True)
        content = source_file.read_text(encoding="utf-8", errors="replace")
        title, artist_raw = extract_title_artist(content)
        artist = clean_name(artist_raw) if artist_raw else UNKNOWN_SINGER
        if artist == UNKNOWN_SINGER:
            missing_artist.append(source_file.name)

        # Keep the source's "-<message id>" suffix so same-titled songs don't collide.
        id_match = re.search(r"-(\d+)$", source_file.stem)
        id_suffix = f"-{id_match.group(1)}" if id_match else ""

        output_name = f"{artist}_{clean_name(title)}{id_suffix}.txt"
        output_file = destination / output_name
        output_file.write_text(clean_lyrics_text(content), encoding="utf-8")
        copied += 1

    report.write_text(
        "Telegram lyrics cleaning report\n"
        f"Source: {source}\nDestination: {destination}\n"
        f"Files copied: {copied}\n"
        f"Files without an Artist tag: {len(missing_artist)}\n\n"
        + "\n".join(missing_artist)
        + "\n",
        encoding="utf-8",
    )
    print(f"Created {destination}")
    print(f"Files copied: {copied}")
    print(f"Missing Artist tag: {len(missing_artist)}")
    print(f"Report: {report}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean and singer-prefix Telegram lyrics text files.")
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("destination", nargs="?", type=Path, default=DEFAULT_DESTINATION)
    args = parser.parse_args()
    process(args.source, args.destination)


if __name__ == "__main__":
    main()

import asyncio
import logging
import os
import re
from datetime import datetime
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from telethon import TelegramClient
from telethon.tl.types import Channel

# Load from the script's own directory, not the current working directory - running via an IDE
# "Run" button or a shell in a different cwd would otherwise silently fail to find .env.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# Enable logging to see errors in the console
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

def required_env(name: str) -> str:
    value = os.getenv(name, '').strip()
    if not value:
        raise RuntimeError(f'Set the {name} environment variable before running this script.')
    return value


# Create a bot with @BotFather and set the token in the BOT_TOKEN environment variable.
BOT_TOKEN = required_env('BOT_TOKEN')

if BOT_TOKEN.startswith('@'):
    raise RuntimeError('The value provided is a bot username, not a Telegram bot token. Use the token from @BotFather instead.')
# '@MezmurLyrics0'
CHANNEL_USERNAME = '@MezmurLyrics0' 
API_ID = int(required_env('TG_API_ID'))
API_HASH = required_env('TG_API_HASH')
SESSION_NAME = 'ReadMezmur'


def sanitize_name(s: str) -> str:
    """Return a filesystem-safe short name derived from s, keeping spaces (no underscores)."""
    if not s:
        return "untitled"
    s = s.strip()
    # keep alnum, dash and space; drop everything else (no underscore substitution)
    safe = "".join(ch if ch.isalnum() or ch in ("-", " ") else "" for ch in s)
    safe = re.sub(r' {2,}', ' ', safe).strip()
    return safe[:100] or "untitled"

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
        r'<pre><br />|</pre>', r'{{Classic', r'</poem>', r'}}'
    ]

    for pattern in patterns_to_remove:
        text = re.sub(pattern, ' ', text)

    text = re.sub(r' {2,}', ' ', text).strip()

    lines = text.splitlines()
    cleaned_lines = []
    verse_number = 1  # Initialize verse number

    for index, line in enumerate(lines):
        line = line.strip()
        if '#' in line:
            continue

        cleaned_lines.append(f" {line}")

    cleaned_text = "\n".join(cleaned_lines)  # Join lines after cleaning
    cleaned_text = remove_extra_blank_lines(cleaned_text)  # Remove extra blank lines
    return cleaned_text

def save_message_to_file(update: Update, text: str) -> None:
    save_dir = r"C:\CEC_MUNICH\temp"
    os.makedirs(save_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    chat_name = (
        update.effective_chat.username
        or update.effective_chat.title
        or f"chat-{update.effective_chat.id}"
    )
    safe_name = "".join(ch if ch.isalnum() or ch == "-" else "" for ch in str(chat_name))
    file_path = os.path.join(save_dir, f"{safe_name}-{timestamp}.txt")

    with open(file_path, "w", encoding="utf-8") as file:
        file.write(clean_lyrics_text(text))


async def save_history_messages() -> None:
    if not API_ID or not API_HASH:
        logging.warning(
            'Telethon API credentials not set; skipping historical message fetch. '
            'Set TG_API_ID and TG_API_HASH environment variables to enable reading old channel messages.'
        )
        return
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    await client.start()
    try:
        entity = await client.get_entity(CHANNEL_USERNAME)
        if not isinstance(entity, Channel):
            logging.warning('Target is not a channel: %s', CHANNEL_USERNAME)
            return

        save_dir = r"C:\CEC_MUNICH\temp\lyrics"
        os.makedirs(save_dir, exist_ok=True)

        async for message in client.iter_messages(entity, limit=2000):
            if not message:
                continue
            # only messages with a date and in 2020
            if not message.date or message.date.year != 2020:
                continue

            # Lyrics text only - no media (audio/video) download.
            caption = getattr(message, 'caption', None) or (message.text if getattr(message, 'text', None) else None)
            if not caption:
                continue

            first_line = caption.splitlines()[0].strip() if caption.splitlines() else caption.strip()
            name = sanitize_name(first_line) or 'untitled'
            file_path = os.path.join(save_dir, f"{name}-{message.id}.txt")
            with open(file_path, 'w', encoding='utf-8') as tfile:
                tfile.write(caption)
            logging.info('Saved lyrics: %s', file_path)
    finally:
        await client.disconnect()


# Define a command handler for the /start command
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Hello! I am your Python-powered Telegram Bot. How can I help you today?"
    )

# Define a message handler to echo back text
async def echo_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text
    save_message_to_file(update, user_text)
    # Respond to the user with their own message
    await update.message.reply_text(f"You said: {user_text}")

def main():
    # Build the application using your bot token
    app = Application.builder().token(BOT_TOKEN).build()

    # Register the command handlers
    app.add_handler(CommandHandler("start", start_command))

    # Register a message handler that listens to all text messages (excluding commands)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo_message))

    # Fetch historical messages once before entering polling mode.
    asyncio.get_event_loop().run_until_complete(save_history_messages())

    # Start polling Telegram's servers for updates.
    print("Bot is starting...")
    try:
        app.run_polling(allowed_updates=Update.ALL_TYPES)
    except Exception as exc:
        if 'Conflict' in str(exc) or 'terminated by other getUpdates request' in str(exc):
            logging.error('Another bot instance is already polling Telegram. Stop the other instance and try again.')
        else:
            raise

if __name__ == '__main__':
    main()
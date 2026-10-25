import { File, Paths } from 'expo-file-system';

// The downloaded Sunday Songs handout lives in the app's own document folder (not the
// phone's Downloads), so the app can reopen it itself - even offline - instead of the user
// having to find the file. Always one file: each download replaces the previous one.
function sundayFile(): File {
  return new File(Paths.document, 'sunday_song.html');
}

export async function saveSundayHtml(date: string): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/sunday/${date}?download=1`);
  if (!response.ok) throw new Error('Could not download the Sunday songs.');
  const html = await response.text();
  const file = sundayFile();
  if (!file.exists) file.create();
  file.write(html);
}

export async function readSundayHtml(): Promise<string> {
  return sundayFile().text();
}

// Which Sunday the saved file is for (from its <title>), or null if nothing is saved -
// lets the error screen offer it when the live list can't load.
export function savedSundayDate(): string | null {
  const file = sundayFile();
  if (!file.exists) return null;
  return /<title>Sunday Songs (\d{4}-\d{2}-\d{2})<\/title>/.exec(file.textSync())?.[1] ?? null;
}

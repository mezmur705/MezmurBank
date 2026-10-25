import { File, Paths } from 'expo-file-system';

// Downloaded Sunday Songs handouts live in the app's own document folder (not the phone's
// Downloads), so the app can reopen them itself - even offline - instead of the user
// having to find the file.
const FILE_PATTERN = /^Sunday-Songs-(\d{4}-\d{2}-\d{2})\.html$/;

function sundayFile(date: string): File {
  return new File(Paths.document, `Sunday-Songs-${date}.html`);
}

export async function saveSundayHtml(date: string): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/sunday/${date}?download=1`);
  if (!response.ok) throw new Error('Could not download the Sunday songs.');
  const html = await response.text();
  const file = sundayFile(date);
  if (!file.exists) file.create();
  file.write(html);
}

export async function readSundayHtml(date: string): Promise<string> {
  return sundayFile(date).text();
}

// Newest saved Sunday, for opening without internet when the live list can't load.
export function latestSavedSundayDate(): string | null {
  const dates = Paths.document
    .list()
    .map(entry => FILE_PATTERN.exec(entry.name)?.[1])
    .filter((d): d is string => !!d)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

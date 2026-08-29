import PptxGenJS from 'pptxgenjs';
import * as FileSystem from 'expo-file-system/legacy';
import type { SongWithSinger } from '../types/models';

interface Slide {
  tag: string;
  lines: string[];
}

// Splits OpenSongFormat text into slides: one per [Vn] tag, lines stripped of their
// leading space. Mirrors parseOpenSongIntoSlides() in server/public/index.html.
function parseOpenSongIntoSlides(openSongFormat: string): Slide[] {
  const slides: Slide[] = [];
  let current: Slide | null = null;
  for (const line of (openSongFormat || '').split(/\r?\n/)) {
    const tagMatch = line.match(/^\[(V\d+)\]$/);
    if (tagMatch) {
      current = { tag: tagMatch[1], lines: [] };
      slides.push(current);
    } else if (current && line.trim()) {
      current.lines.push(line.replace(/^ /, ''));
    }
  }
  return slides;
}

function formatOpenSongId(openSongId: number | null): string {
  return openSongId == null ? '----' : String(openSongId).padStart(4, '0');
}

// pptxgenjs's fit:'shrink' only writes a PowerPoint autofit hint that PowerPoint applies
// lazily after you manually edit the shape - it doesn't shrink the text in the generated
// file. So the font size is computed up front from line count / longest line instead.
// Mirrors computeVerseFontSize() in server/public/index.html.
function computeVerseFontSize(lines: string[], boxWidthIn: number, boxHeightIn: number, maxSize: number): number {
  const lineCount = Math.max(1, lines.length);
  const maxLen = Math.max(1, ...lines.map(l => l.length));
  const heightFit = (boxHeightIn * 72) / (lineCount * 1.3);
  const widthFit = (boxWidthIn * 72) / (maxLen * 0.6);
  return Math.max(20, Math.min(maxSize, Math.floor(Math.min(heightFit, widthFit))));
}

// Generates a .pptx (one slide per [Vn] verse), matching the web app's export design
// exactly (server/public/index.html's exportOpenSongToPptx), and returns a local file URI.
export async function generateLyricsPptx(song: SongWithSinger): Promise<string> {
  const source = song.open_song_format || song.lyrics;
  const slidesData = parseOpenSongIntoSlides(source);
  if (!slidesData.length) {
    throw new Error('No OpenSong Format data available for this song.');
  }

  const pptx = new PptxGenJS();
  const singerLabel = `${song.singers?.name ?? ''} (#${formatOpenSongId(song.open_song_id)})`;
  pptx.layout = 'LAYOUT_WIDE';

  for (const s of slidesData) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(song.title, {
      x: 0.3, y: 0.15, w: '94%', h: 0.6,
      align: 'center', fontSize: 30, color: '000000', fontFace: 'Nyala', bold: true, italic: true,
    });
    const fontSize = computeVerseFontSize(s.lines, 12.0, 5.4, 55);
    slide.addText(s.lines.join('\n'), {
      x: 0.5, y: 0.9, w: '90%', h: 5.4,
      align: 'center', valign: 'middle',
      fontSize, color: '000000', fontFace: 'Nyala', bold: true, breakLine: true,
    });
    slide.addText(singerLabel, {
      x: 0.3, y: 6.85, w: '94%', h: 0.5,
      align: 'center', fontSize: 30, color: '000000', fontFace: 'Nyala', bold: true, italic: true,
    });
  }

  const base64 = (await pptx.write({ outputType: 'base64' })) as string;
  const fileName = `${song.title} - ${song.singers?.name ?? ''}.pptx`.replace(/[/\\?%*:|"<>]/g, '-');
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

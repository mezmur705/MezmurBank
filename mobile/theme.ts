export const colors = {
  background: '#121212',
  surface: '#181818',
  card: '#282828',
  cardPressed: '#333333',
  accent: '#1DB954',
  textPrimary: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary: '#727272',
  border: '#2A2A2A',
  highlight: '#ffe066',
  highlightText: '#121212',
  error: '#F15E6C',
};

export const avatarPalette = [
  '#1DB954',
  '#E13300',
  '#8D67AB',
  '#1E3264',
  '#E8115B',
  '#F59B23',
  '#509BF5',
  '#BA5D07',
];

export function colorForId(id: number | string): string {
  const key = typeof id === 'number' ? id : id.length;
  return avatarPalette[key % avatarPalette.length];
}

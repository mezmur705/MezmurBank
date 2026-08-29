import React from 'react';
import { Text, StyleSheet, type TextStyle, type StyleProp, type TextProps } from 'react-native';
import { colors } from '../theme';

interface Props {
  text: string;
  query: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: TextProps['numberOfLines'];
  ellipsizeMode?: TextProps['ellipsizeMode'];
}

// Splits `text` on the (case-insensitive) occurrences of `query` and wraps each
// match in a yellow-highlighted Text span.
export default function HighlightText({ text, query, style, numberOfLines, ellipsizeMode }: Props) {
  const q = query.trim();
  if (!q) {
    return (
      <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>
        {text}
      </Text>
    );
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = q.toLowerCase();
  const parts: { value: string; match: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lowerText.indexOf(lowerQuery, i);
    if (idx === -1) {
      parts.push({ value: text.slice(i), match: false });
      break;
    }
    if (idx > i) parts.push({ value: text.slice(i, idx), match: false });
    parts.push({ value: text.slice(idx, idx + q.length), match: true });
    i = idx + q.length;
  }

  return (
    <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>
      {parts.map((part, idx) =>
        part.match ? (
          <Text key={idx} style={styles.highlight}>
            {part.value}
          </Text>
        ) : (
          <Text key={idx}>{part.value}</Text>
        )
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  highlight: {
    backgroundColor: colors.highlight,
    color: colors.highlightText,
    borderRadius: 3,
  },
});

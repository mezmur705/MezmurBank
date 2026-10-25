import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { upcomingSundays, formatSundayDate } from '../lib/sundayDates';
import { colors } from '../theme';

// Pop-up list of the next month's Sundays (nearest first). Used to switch the Sunday Songs
// list and to choose which Sunday an exported song is added to.
export default function SundayPicker({
  visible,
  title,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected?: string | null;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {upcomingSundays().map((date, index) => (
            <TouchableOpacity key={date} style={styles.item} onPress={() => onSelect(date)} activeOpacity={0.6}>
              <Text style={[styles.itemText, date === selected && styles.selectedText]}>
                {formatSundayDate(date)}
                {index === 0 ? '  (nearest)' : ''}
              </Text>
              {date === selected ? <MaterialIcons name="check" size={20} color={colors.accent} /> : null}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 8 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, paddingHorizontal: 16, paddingVertical: 10 },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  itemText: { fontSize: 15, color: colors.textPrimary },
  selectedText: { color: colors.accent, fontWeight: '700' },
});

import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, FlatList, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ChoirMember } from '../lib/api';
import { colors } from '../theme';

// Pop-up checklist of Mezmurify sign-in names; several can be ticked. Used for the Choir
// Plan roles (Lead Singer, Keyboard, Guitar).
export default function MemberPicker({
  visible,
  title,
  members,
  selected,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  members: ChoirMember[];
  selected: ChoirMember[];
  onChange: (next: ChoirMember[]) => void;
  onClose: () => void;
}) {
  const picked = new Set(selected.map(m => m.email));
  const toggle = (member: ChoirMember) => {
    onChange(picked.has(member.email) ? selected.filter(m => m.email !== member.email) : [...selected, member]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <FlatList
            data={members}
            keyExtractor={m => m.email}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.item} onPress={() => toggle(item)} activeOpacity={0.6}>
                <MaterialIcons
                  name={picked.has(item.email) ? 'check-box' : 'check-box-outline-blank'}
                  size={22}
                  color={picked.has(item.email) ? colors.accent : colors.textSecondary}
                />
                <Text style={styles.itemText}>{item.name}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No members found.</Text>}
          />
          <TouchableOpacity style={styles.done} onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 8, maxHeight: '80%' },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, paddingHorizontal: 16, paddingVertical: 10 },
  list: { flexGrow: 0 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  itemText: { fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
  empty: { color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 12 },
  done: { alignSelf: 'flex-end', paddingHorizontal: 20, paddingVertical: 12 },
  doneText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
});

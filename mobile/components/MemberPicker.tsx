import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, FlatList, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ChoirMember, ChoirPerson } from '../lib/api';
import { colors } from '../theme';

// Pop-up checklist of choir members; several can be ticked. Used for the Choir Plan roles
// (Lead Singer, Keyboard, Guitar). Older assignments are matched by email.
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
  selected: ChoirPerson[];
  onChange: (next: ChoirPerson[]) => void;
  onClose: () => void;
}) {
  const isPicked = (member: ChoirMember) =>
    selected.some(p => p.memberId === member.id || (!!member.email && p.email === member.email));
  const toggle = (member: ChoirMember) => {
    onChange(
      isPicked(member)
        ? selected.filter(p => !(p.memberId === member.id || (!!member.email && p.email === member.email)))
        : [...selected, { memberId: member.id, ...(member.email ? { email: member.email } : {}), name: member.name }]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <FlatList
            data={members}
            keyExtractor={m => String(m.id)}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.item} onPress={() => toggle(item)} activeOpacity={0.6}>
                <MaterialIcons
                  name={isPicked(item) ? 'check-box' : 'check-box-outline-blank'}
                  size={22}
                  color={isPicked(item) ? colors.accent : colors.textSecondary}
                />
                <Text style={styles.itemText}>
                  {item.name}
                  {item.group ? <Text style={styles.itemGroup}>  ቡድን {item.group}</Text> : null}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No choir members yet - add them under Members.</Text>}
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
  itemGroup: { fontSize: 13, color: colors.textSecondary },
  empty: { color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 12 },
  done: { alignSelf: 'flex-end', paddingHorizontal: 20, paddingVertical: 12 },
  doneText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
});

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getChoirMembers, getChoirUsers, getCanExport, saveChoirMember } from '../lib/api';
import type { ChoirMember, ChoirUser } from '../lib/api';
import { colors } from '../theme';

type Group = 'A' | 'B' | null;

// The choir member list that Choir Plan roles are picked from. Everyone signed in sees it;
// admins and users with export rights add members (a Mezmurify user or any typed name),
// set their group and remove them.
export default function ChoirMembers() {
  const { session } = useAuth();
  const [members, setMembers] = useState<ChoirMember[]>([]);
  const [users, setUsers] = useState<ChoirUser[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>(null);
  const [userPickerOpen, setUserPickerOpen] = useState(false);

  const load = useCallback(() => {
    if (!session) return;
    const token = session.access_token;
    setLoading(true);
    Promise.all([getChoirMembers(token), getCanExport(token)])
      .then(async ([list, editor]) => {
        setMembers(list);
        setCanEdit(editor);
        if (editor) setUsers(await getChoirUsers(token).catch(() => []));
      })
      .catch(err => Alert.alert('Could not load members', err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, [session?.access_token]);

  useFocusEffect(load);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      load();
    } catch (err) {
      Alert.alert('Choir members', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => {
    if (!session) return;
    if (!name.trim()) {
      Alert.alert('Name missing', 'Pick a Mezmurify user or type a name.');
      return;
    }
    run(async () => {
      await saveChoirMember(session.access_token, { name: name.trim(), email, group });
      setName('');
      setEmail(null);
      setGroup(null);
    });
  };

  const setMemberGroup = (m: ChoirMember, next: Group) => {
    if (!session) return;
    run(() => saveChoirMember(session.access_token, { id: m.id, name: m.name, email: m.email, group: next }));
  };

  const removeMember = (m: ChoirMember) => {
    if (!session) return;
    Alert.alert('Remove member?', `Remove ${m.name} from the choir member list?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run(() => saveChoirMember(session.access_token, { id: m.id }, true)) },
    ]);
  };

  const memberEmails = new Set(members.map(m => m.email).filter(Boolean));
  const pickableUsers = users.filter(u => !memberEmails.has(u.email));

  const groupChips = (value: Group, onPick: (g: Group) => void) => (
    <View style={styles.chips}>
      {(['A', 'B'] as const).map(g => (
        <TouchableOpacity key={g} style={[styles.chip, value === g && styles.chipOn]} onPress={() => onPick(value === g ? null : g)}>
          <Text style={[styles.chipText, value === g && styles.chipTextOn]}>{g}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (loading && !members.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const addForm = canEdit ? (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Add a member</Text>
      <TouchableOpacity style={styles.pickUser} onPress={() => setUserPickerOpen(true)}>
        <MaterialCommunityIcons name="account-search" size={18} color={colors.textSecondary} />
        <Text style={styles.pickUserText}>Pick a Mezmurify user</Text>
      </TouchableOpacity>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={text => {
          setName(text);
          setEmail(null); // typed by hand = not linked to an account
        }}
        placeholder="…or type a name"
        placeholderTextColor={colors.textTertiary}
        maxLength={200}
      />
      <View style={styles.groupRow}>
        <Text style={styles.groupLabel}>Group</Text>
        {groupChips(group, setGroup)}
      </View>
      <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color={colors.highlightText} /> : <Text style={styles.addText}>Add member</Text>}
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <>
      <Modal visible={userPickerOpen} transparent animationType="fade" onRequestClose={() => setUserPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setUserPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Pick a Mezmurify user</Text>
            <FlatList
              data={pickableUsers}
              keyExtractor={u => u.email}
              style={styles.sheetList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.sheetItem}
                  onPress={() => {
                    setName(item.name);
                    setEmail(item.email);
                    setUserPickerOpen(false);
                  }}
                >
                  <Text style={styles.sheetItemText}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.empty}>Everyone with an account is already a member.</Text>}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <FlatList
        style={styles.container}
        data={members}
        keyExtractor={m => String(m.id)}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={addForm}
        ListEmptyComponent={<Text style={styles.empty}>No choir members yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.name}
              {item.email ? '  👤' : ''}
            </Text>
            {canEdit ? (
              <>
                {groupChips(item.group, g => setMemberGroup(item, g))}
                <TouchableOpacity onPress={() => removeMember(item)} style={styles.iconButton} accessibilityLabel={`Remove ${item.name}`}>
                  <MaterialCommunityIcons name="delete-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.rowGroup}>{item.group ? `ቡድን ${item.group}` : '—'}</Text>
            )}
          </View>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  listContent: { padding: 16, paddingBottom: 32 },
  form: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 16, gap: 10 },
  formTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  pickUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickUserText: { color: colors.textPrimary, fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupLabel: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textPrimary, fontSize: 13 },
  chipTextOn: { color: colors.highlightText, fontWeight: '700' },
  addButton: { backgroundColor: colors.accent, paddingVertical: 12, borderRadius: 24, alignItems: 'center' },
  addText: { color: colors.highlightText, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowName: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  rowGroup: { color: colors.textSecondary, fontSize: 14 },
  iconButton: { padding: 6 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 8, maxHeight: '80%' },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, paddingHorizontal: 16, paddingVertical: 10 },
  sheetList: { flexGrow: 0 },
  sheetItem: { paddingHorizontal: 16, paddingVertical: 12 },
  sheetItemText: { color: colors.textPrimary, fontSize: 15 },
});

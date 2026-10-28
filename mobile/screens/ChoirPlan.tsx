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
  Linking,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { getChoirPlan, saveChoirRehearsal, deleteChoirRehearsal, getChoirMembers } from '../lib/api';
import type { ChoirRehearsal, ChoirMember, ChoirPerson } from '../lib/api';
import MemberPicker from '../components/MemberPicker';
import { formatSundayDate } from '../lib/sundayDates';
import { colors } from '../theme';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeString = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Usual rehearsal: 09:30-13:00 in Dachau - prefilled for new entries, still editable.
const DEFAULT_START = '09:30';
const DEFAULT_END = '13:00';
const DEFAULT_PLACE = 'Dachau';

type PeopleRole = 'leadSinger' | 'keyboard' | 'guitar';
const PEOPLE_ROLES: [PeopleRole, string][] = [
  ['leadSinger', 'መሪ ዘማሪ'],
  ['keyboard', 'ኪቦርድ'],
  ['guitar', 'ጊታር'],
];
const emptyRoles = (): Record<PeopleRole, ChoirPerson[]> => ({ leadSinger: [], keyboard: [], guitar: [] });

// Choir rehearsal schedule. Everyone signed in sees the upcoming rehearsals; admins and users
// with export rights (the ones who plan Sunday Songs) also get the add/edit/delete controls.
export default function ChoirPlan() {
  const { session, promptSignIn } = useAuth();
  const [rehearsals, setRehearsals] = useState<ChoirRehearsal[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(DEFAULT_START);
  const [endTime, setEndTime] = useState<string | null>(DEFAULT_END);
  const [place, setPlace] = useState(DEFAULT_PLACE);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<ChoirMember[]>([]);
  const [roles, setRoles] = useState<Record<PeopleRole, ChoirPerson[]>>(emptyRoles());
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [groups, setGroups] = useState<('A' | 'B')[]>([]);
  const [training, setTraining] = useState<boolean | null>(null);
  const [trainingReason, setTrainingReason] = useState('');
  const [pickerRole, setPickerRole] = useState<PeopleRole | null>(null);

  const load = useCallback(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getChoirPlan(session.access_token)
      .then(data => {
        setRehearsals(data.rehearsals);
        setCanEdit(data.canEdit);
        getChoirMembers(session.access_token).then(setMembers).catch(() => setMembers([]));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load the choir plan.'))
      .finally(() => setLoading(false));
  }, [session?.access_token]);

  useFocusEffect(load);

  const resetForm = () => {
    setEditingId(null);
    setDate(null);
    setStartTime(DEFAULT_START);
    setEndTime(DEFAULT_END);
    setPlace(DEFAULT_PLACE);
    setNotes('');
    setRoles(emptyRoles());
    setGroups([]);
    setTraining(null);
    setTrainingReason('');
  };

  const startEdit = (r: ChoirRehearsal) => {
    setEditingId(r.id);
    setDate(r.date);
    setStartTime(r.startTime);
    setEndTime(r.endTime);
    setPlace(r.place ?? '');
    setNotes(r.notes ?? '');
    setRoles({
      leadSinger: r.assignments?.leadSinger ?? [],
      keyboard: r.assignments?.keyboard ?? [],
      guitar: r.assignments?.guitar ?? [],
    });
    setGroups(r.assignments?.singerGroup ?? []);
    setTraining(r.saturdayTraining);
    setTrainingReason(r.trainingReason ?? '');
  };

  const toggleGroup = (g: 'A' | 'B') =>
    setGroups(prev => (prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g].sort()));

  const pickDate = () => {
    DateTimePickerAndroid.open({
      value: date ? new Date(`${date}T12:00:00`) : new Date(),
      mode: 'date',
      minimumDate: new Date(),
      onChange: (event, picked) => {
        if (event.type === 'set' && picked) setDate(toDateString(picked));
      },
    });
  };

  const pickTime = (current: string | null, set: (t: string) => void) => {
    const value = new Date();
    if (current) {
      const [h, m] = current.split(':').map(Number);
      value.setHours(h, m, 0, 0);
    } else {
      value.setHours(18, 0, 0, 0);
    }
    DateTimePickerAndroid.open({
      value,
      mode: 'time',
      is24Hour: true,
      onChange: (event, picked) => {
        if (event.type === 'set' && picked) set(toTimeString(picked));
      },
    });
  };

  const handleSave = async () => {
    if (!session || saving) return;
    if (!date) {
      Alert.alert('Choose a date', 'Please pick the date first.');
      return;
    }
    setSaving(true);
    try {
      await saveChoirRehearsal(
        session.access_token,
        {
          date,
          startTime,
          endTime,
          place: place.trim() || null,
          notes: notes.trim() || null,
          assignments: { ...roles, singerGroup: groups },
          saturdayTraining: training,
          trainingReason: training === false ? trainingReason.trim() || null : null,
        },
        editingId ?? undefined
      );
      resetForm();
      load();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  // WhatsApp can't be posted to a group automatically, so this opens WhatsApp with the
  // announcement ready - pick the choir group and press send.
  const sendToWhatsApp = async (r: ChoirRehearsal) => {
    const a = r.assignments ?? {};
    const time = [r.startTime, r.endTime].filter(Boolean).join(' – ');
    const lines = ['🎶 *Choir Plan*', `*${formatSundayDate(r.date)}*${time ? ` · ${time}` : ''}`];
    if (r.place) lines.push(`📍 ${r.place}`);
    lines.push('');
    PEOPLE_ROLES.forEach(([key, label]) => {
      if (a[key]?.length) lines.push(`*${label}:* ${a[key]!.map(m => m.name).join(', ')}`);
    });
    if (a.singerGroup?.length) lines.push(`*የዘማሪዎች ቡድን:* ${a.singerGroup.map(g => `ቡድን ${g}`).join(', ')}`);
    if (r.saturdayTraining === true) lines.push('*የቅዳሜ ልምምድ:* አዎ');
    if (r.saturdayTraining === false) lines.push(`*የቅዳሜ ልምምድ:* የለም${r.trainingReason ? ` – ${r.trainingReason}` : ''}`);
    if (r.notes) lines.push('', r.notes);
    lines.push('', `${process.env.EXPO_PUBLIC_API_URL ?? 'https://mezmurify.com'} → Choir Plan`);
    const text = encodeURIComponent(lines.join('\n').replace(/\n{3,}/g, '\n\n'));
    try {
      await Linking.openURL(`whatsapp://send?text=${text}`);
    } catch {
      Linking.openURL(`https://wa.me/?text=${text}`);
    }
  };

  const handleDelete = (r: ChoirRehearsal) => {
    if (!session) return;
    Alert.alert('Delete ሳምንታዊ የአምልኮ ፕሮግራም?', formatSundayDate(r.date), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteChoirRehearsal(session.access_token, r.id);
            if (editingId === r.id) resetForm();
            load();
          } catch (err) {
            Alert.alert('Could not delete', err instanceof Error ? err.message : 'Unknown error');
          }
        },
      },
    ]);
  };

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Please sign in to see the choir plan.</Text>
        <TouchableOpacity onPress={promptSignIn} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading && !rehearsals.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={load} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const membersButton = (
    <TouchableOpacity style={styles.membersButton} onPress={() => navigation.navigate('ChoirMembers')}>
      <MaterialCommunityIcons name="account-group" size={20} color={colors.accent} />
      <Text style={styles.membersButtonText}>Choir Members ({members.length})</Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  const form = canEdit ? (
    <View style={styles.form}>
      <Text style={styles.formTitle}>{editingId ? '✏️ ሳምንታዊ የአምልኮ ፕሮግራም' : '➕ ሳምንታዊ የአምልኮ ፕሮግራም'}</Text>
      <View style={styles.pickRow}>
        <TouchableOpacity style={[styles.pickButton, styles.pickDate]} onPress={pickDate}>
          <MaterialCommunityIcons name="calendar" size={18} color={colors.textSecondary} />
          <Text style={styles.pickText} numberOfLines={1}>{date ? formatSundayDate(date) : 'Date'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.pickRow}>
        <TouchableOpacity style={styles.pickButton} onPress={() => pickTime(startTime, setStartTime)}>
          <MaterialCommunityIcons name="clock-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.pickText}>{startTime ?? 'From'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pickButton} onPress={() => pickTime(endTime, setEndTime)}>
          <MaterialCommunityIcons name="clock-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.pickText}>{endTime ?? 'To'}</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={place}
        onChangeText={setPlace}
        placeholder="Place"
        placeholderTextColor={colors.textTertiary}
        maxLength={200}
      />
      {PEOPLE_ROLES.map(([key, label]) => (
        <TouchableOpacity key={key} style={styles.roleButton} onPress={() => setPickerRole(key)}>
          <Text style={styles.roleLabel}>{label}</Text>
          <Text style={styles.roleNames} numberOfLines={2}>
            {roles[key].length ? roles[key].map(m => m.name).join(', ') : 'Choose…'}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      ))}
      <View style={styles.choiceRow}>
        <Text style={styles.roleLabel}>የዘማሪዎች ቡድን</Text>
        {(['A', 'B'] as const).map(g => (
          <TouchableOpacity key={g} style={[styles.chip, groups.includes(g) && styles.chipOn]} onPress={() => toggleGroup(g)}>
            <Text style={[styles.chipText, groups.includes(g) && styles.chipTextOn]}>ቡድን {g}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.choiceRow}>
        <Text style={styles.roleLabel}>የቅዳሜ ልምምድ</Text>
        {([true, false] as const).map(value => (
          <TouchableOpacity
            key={String(value)}
            style={[styles.chip, training === value && styles.chipOn]}
            onPress={() => setTraining(training === value ? null : value)}
          >
            <Text style={[styles.chipText, training === value && styles.chipTextOn]}>{value ? 'አዎ' : 'የለም'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {training === false ? (
        <TextInput
          style={styles.input}
          value={trainingReason}
          onChangeText={setTrainingReason}
          placeholder="Reason (e.g. hall not available)"
          placeholderTextColor={colors.textTertiary}
          maxLength={500}
        />
      ) : null}
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes (songs to practice, what to bring…)"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={2000}
      />
      <View style={styles.formButtons}>
        <TouchableOpacity style={[styles.primaryButton, styles.saveButton]} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.highlightText} />
          ) : (
            <Text style={styles.primaryText}>{editingId ? 'Save' : 'Add'}</Text>
          )}
        </TouchableOpacity>
        {editingId ? (
          <TouchableOpacity onPress={resetForm} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  ) : null;

  // Two-column table rows (activity, who); every activity is listed, "—" while unassigned.
  const roleRows = (r: ChoirRehearsal): [string, string][] => [
    ...PEOPLE_ROLES.map(([key, label]): [string, string] => [label, (r.assignments?.[key] ?? []).map(m => m.name).join(', ')]),
    ['የዘማሪዎች ቡድን', (r.assignments?.singerGroup ?? []).map(g => `ቡድን ${g}`).join(', ')],
    [
      'የቅዳሜ ልምምድ',
      r.saturdayTraining === true ? 'አዎ' : r.saturdayTraining === false ? `የለም${r.trainingReason ? ` – ${r.trainingReason}` : ''}` : '',
    ],
  ];

  const renderItem = ({ item }: { item: ChoirRehearsal }) => {
    const time = [item.startTime, item.endTime].filter(Boolean).join(' – ');
    return (
      <View style={styles.item}>
        <View style={styles.itemText}>
          <Text style={styles.itemDate}>
            {formatSundayDate(item.date)}
            {time ? ` · ${time}` : ''}
          </Text>
          {item.place ? <Text style={styles.itemPlace}>📍 {item.place}</Text> : null}
          <View style={styles.table}>
            {roleRows(item).map(([label, value], index) => (
              <View key={label} style={[styles.tableRow, index > 0 && styles.tableRowBorder]}>
                <Text style={styles.tableLabel}>{label}</Text>
                <Text style={styles.tableValue}>{value || '—'}</Text>
              </View>
            ))}
          </View>
          {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
        </View>
        <View style={styles.itemActions}>
          <TouchableOpacity onPress={() => sendToWhatsApp(item)} accessibilityLabel="Send to WhatsApp" style={styles.iconButton}>
            <MaterialCommunityIcons name="whatsapp" size={22} color="#25D366" />
          </TouchableOpacity>
        </View>
        {canEdit ? (
          <View style={styles.itemActions}>
            <TouchableOpacity onPress={() => startEdit(item)} accessibilityLabel="Edit ሳምንታዊ የአምልኮ ፕሮግራም" style={styles.iconButton}>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(item)} accessibilityLabel="Delete ሳምንታዊ የአምልኮ ፕሮግራም" style={styles.iconButton}>
              <MaterialCommunityIcons name="delete-outline" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <>
      <MemberPicker
        visible={pickerRole !== null}
        title={PEOPLE_ROLES.find(([key]) => key === pickerRole)?.[1] ?? ''}
        members={members}
        selected={pickerRole ? roles[pickerRole] : []}
        onChange={next => pickerRole && setRoles(prev => ({ ...prev, [pickerRole]: next }))}
        onClose={() => setPickerRole(null)}
      />
      <FlatList
        style={styles.container}
        data={rehearsals}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        ListHeaderComponent={
          <>
            {membersButton}
            {form}
          </>
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No ሳምንታዊ የአምልኮ ፕሮግራም planned yet.</Text>}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  listContent: { padding: 16, paddingBottom: 32 },
  hint: { color: colors.textSecondary, marginBottom: 12, textAlign: 'center' },
  errorText: { color: colors.error, marginBottom: 12, textAlign: 'center' },
  primaryButton: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, alignItems: 'center' },
  primaryText: { color: colors.highlightText, fontWeight: '700' },
  form: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 16, gap: 10 },
  formTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  pickRow: { flexDirection: 'row', gap: 10 },
  pickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickDate: { flex: 1 },
  pickText: { color: colors.textPrimary, fontSize: 14, flexShrink: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  notesInput: { minHeight: 64, textAlignVertical: 'top' },
  formButtons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  saveButton: { flex: 1 },
  cancelButton: { paddingHorizontal: 12, paddingVertical: 10 },
  cancelText: { color: colors.textSecondary, fontWeight: '600' },
  item: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  itemText: { flex: 1, minWidth: 0 },
  itemDate: { fontSize: 15, fontWeight: '700', color: colors.accent },
  itemPlace: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  membersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  membersButtonText: { flex: 1, color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
  roleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  roleLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', minWidth: 84 },
  roleNames: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textPrimary, fontSize: 14 },
  chipTextOn: { color: colors.highlightText, fontWeight: '700' },
  table: { marginTop: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  tableRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  tableLabel: {
    width: '42%',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.card,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  tableValue: { flex: 1, paddingHorizontal: 8, paddingVertical: 6, color: colors.textPrimary, fontSize: 14 },
  itemNotes: { fontSize: 14, color: colors.textPrimary, marginTop: 4 },
  itemActions: { flexDirection: 'row', gap: 4 },
  iconButton: { padding: 6 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
});

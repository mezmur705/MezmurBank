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
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getChoirPlan, saveChoirRehearsal, deleteChoirRehearsal } from '../lib/api';
import type { ChoirRehearsal } from '../lib/api';
import { formatSundayDate } from '../lib/sundayDates';
import { colors } from '../theme';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeString = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

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
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [place, setPlace] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

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
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load the choir plan.'))
      .finally(() => setLoading(false));
  }, [session?.access_token]);

  useFocusEffect(load);

  const resetForm = () => {
    setEditingId(null);
    setDate(null);
    setStartTime(null);
    setEndTime(null);
    setPlace('');
    setNotes('');
  };

  const startEdit = (r: ChoirRehearsal) => {
    setEditingId(r.id);
    setDate(r.date);
    setStartTime(r.startTime);
    setEndTime(r.endTime);
    setPlace(r.place ?? '');
    setNotes(r.notes ?? '');
  };

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
      Alert.alert('Choose a date', 'Please pick the rehearsal date first.');
      return;
    }
    setSaving(true);
    try {
      await saveChoirRehearsal(
        session.access_token,
        { date, startTime, endTime, place: place.trim() || null, notes: notes.trim() || null },
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

  const handleDelete = (r: ChoirRehearsal) => {
    if (!session) return;
    Alert.alert('Delete rehearsal?', formatSundayDate(r.date), [
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

  const form = canEdit ? (
    <View style={styles.form}>
      <Text style={styles.formTitle}>{editingId ? 'Edit rehearsal' : 'Add a rehearsal'}</Text>
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
        placeholder="Place (e.g. church hall)"
        placeholderTextColor={colors.textTertiary}
        maxLength={200}
      />
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
          {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
        </View>
        {canEdit ? (
          <View style={styles.itemActions}>
            <TouchableOpacity onPress={() => startEdit(item)} accessibilityLabel="Edit rehearsal" style={styles.iconButton}>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(item)} accessibilityLabel="Delete rehearsal" style={styles.iconButton}>
              <MaterialCommunityIcons name="delete-outline" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <FlatList
      style={styles.container}
      data={rehearsals}
      keyExtractor={item => String(item.id)}
      renderItem={renderItem}
      ListHeaderComponent={form}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={<Text style={styles.empty}>No upcoming rehearsals planned yet.</Text>}
    />
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
  itemNotes: { fontSize: 14, color: colors.textPrimary, marginTop: 4 },
  itemActions: { flexDirection: 'row', gap: 4 },
  iconButton: { padding: 6 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
});

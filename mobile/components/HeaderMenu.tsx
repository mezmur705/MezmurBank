import React, { useState } from 'react';
import { View, TouchableOpacity, Modal, Pressable, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export default function HeaderMenu() {
  const [open, setOpen] = useState(false);
  const { user, signOut, promptSignIn } = useAuth();
  const navigation = useNavigation<NavProp>();

  const goToAccountScreen = (screen: 'Favorites' | 'RecentlyViewed') => {
    setOpen(false);
    if (!user) {
      promptSignIn();
      return;
    }
    navigation.navigate(screen);
  };

  const goToDriveExports = () => {
    setOpen(false);
    navigation.navigate('DriveExports');
  };

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} accessibilityLabel="Menu" style={styles.trigger}>
        <MaterialIcons name="menu" size={26} color={colors.textPrimary} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            <MenuItem icon="favorite-border" label="Favorites" onPress={() => goToAccountScreen('Favorites')} />
            <MenuItem icon="history" label="Recently Viewed" onPress={() => goToAccountScreen('RecentlyViewed')} />
            <MenuItem icon="folder-shared" label="Exported Files" onPress={goToDriveExports} />
            <View style={styles.divider} />
            {user ? (
              <MenuItem
                icon="logout"
                label="Sign Out"
                destructive
                onPress={() => {
                  setOpen(false);
                  signOut();
                }}
              />
            ) : (
              <MenuItem
                icon="login"
                label="Sign In"
                onPress={() => {
                  setOpen(false);
                  promptSignIn();
                }}
              />
            )}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.item} onPress={onPress} activeOpacity={0.6}>
      <MaterialIcons name={icon} size={20} color={destructive ? colors.error : colors.textPrimary} />
      <Text style={[styles.itemText, destructive && { color: colors.error }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  trigger: { marginRight: 4, padding: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  menu: {
    position: 'absolute',
    top: 56,
    right: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 210,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  itemText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
});

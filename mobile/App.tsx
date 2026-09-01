import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LibraryProvider } from './context/LibraryContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import SignInSheet from './components/SignInSheet';
import HeaderMenu from './components/HeaderMenu';
import { colors } from './theme';
import type { RootStackParamList } from './navigation/types';
import SingersList from './screens/SingersList';
import SongsList from './screens/SongsList';
import SongDetail from './screens/SongDetail';
import RecentlyViewed from './screens/RecentlyViewed';
import Favorites from './screens/Favorites';
import DriveExports from './screens/DriveExports';
import SundaySongs from './screens/SundaySongs';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.accent,
  },
};

function RootNavigator() {
  const { signInSheetVisible, dismissSignInSheet } = useAuth();

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName="SingersList"
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          headerRight: () => <HeaderMenu />,
        }}
      >
        <Stack.Screen name="SingersList" component={SingersList} options={{ title: 'Mezmurify' }} />
        <Stack.Screen
          name="SongsList"
          component={SongsList}
          options={({ route }) => ({ title: route.params.singerName })}
        />
        <Stack.Screen name="SongDetail" component={SongDetail} options={{ title: '' }} />
        <Stack.Screen name="RecentlyViewed" component={RecentlyViewed} options={{ title: 'Recently Viewed' }} />
        <Stack.Screen name="Favorites" component={Favorites} options={{ title: 'Favorites' }} />
        <Stack.Screen name="DriveExports" component={DriveExports} options={{ title: 'Exported Files' }} />
        <Stack.Screen name="SundaySongs" component={SundaySongs} options={{ title: 'Sunday Songs' }} />
      </Stack.Navigator>
      <SignInSheet visible={signInSheetVisible} onClose={dismissSignInSheet} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LibraryProvider>
        <RootNavigator />
        <StatusBar style="light" />
      </LibraryProvider>
    </AuthProvider>
  );
}

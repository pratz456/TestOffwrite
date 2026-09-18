import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { mobileAuth, signOutMobile } from './src/auth/firebase';
import { SignInScreen } from './src/screens/SignInScreen';
import { TripsScreen } from './src/screens/TripsScreen';
import { ReceiptScreen } from './src/screens/ReceiptScreen';

const Tabs = createBottomTabNavigator();

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => onAuthStateChanged(mobileAuth(), setUser), []);

  if (user === undefined) return null;
  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      {user ? (
        <Tabs.Navigator
          screenOptions={{
            headerRight: () => (
              <Pressable accessibilityRole="button" onPress={() => void signOutMobile()} style={{ paddingHorizontal: 16 }}>
                <Text style={{ color: '#2563eb' }}>Sign out</Text>
              </Pressable>
            ),
          }}
        >
          <Tabs.Screen name="Trips" component={TripsScreen} />
          <Tabs.Screen name="Receipts" component={ReceiptScreen} />
        </Tabs.Navigator>
      ) : (
        <SignInScreen />
      )}
    </NavigationContainer>
  );
}

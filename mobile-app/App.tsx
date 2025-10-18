import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/contexts/AuthContext';
import { COLORS } from './src/lib/theme';

function App(): JSX.Element {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar
          backgroundColor={COLORS.secondary}
          barStyle="light-content"
        />
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default App;

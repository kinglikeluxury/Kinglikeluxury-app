import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { COLORS } from './src/lib/theme';

function App(): JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar
        backgroundColor={COLORS.secondary}
        barStyle="light-content"
      />
      <AppNavigator />
    </SafeAreaProvider>
  );
}

export default App;
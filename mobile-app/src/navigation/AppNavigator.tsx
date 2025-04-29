import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '@screens/HomeScreen';
import PropertyDetailsScreen from '@screens/PropertyDetailsScreen';
import ARPropertyViewScreen from '@screens/ARPropertyViewScreen';
import { COLORS } from '@lib/theme';

export type RootStackParamList = {
  Home: undefined;
  PropertyDetails: { propertyId: number };
  ARPropertyView: { 
    propertyId: number;
    modelUrl?: string;
    floorPlanUrl?: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: COLORS.primary,
          },
          headerTintColor: COLORS.white,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Kinglike Luxury' }}
        />
        <Stack.Screen
          name="PropertyDetails"
          component={PropertyDetailsScreen}
          options={{ title: 'Property Details' }}
        />
        <Stack.Screen
          name="ARPropertyView"
          component={ARPropertyViewScreen}
          options={{ 
            title: 'AR View',
            headerShown: true,
            animation: 'slide_from_bottom'
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '@screens/HomeScreen';
import PropertyDetailsScreen from '@screens/PropertyDetailsScreen';
import ARPropertyViewScreen from '@screens/ARPropertyViewScreen';
import LoginScreen from '@screens/LoginScreen';
import RegisterScreen from '@screens/RegisterScreen';
import ProjectsScreen from '@screens/ProjectsScreen';
import BlogScreen from '@screens/BlogScreen';
import SubmitPropertyScreen from '@screens/SubmitPropertyScreen';
import PropertyFormScreen from '@screens/PropertyFormScreen';
import AdminDashboardScreen from '@screens/AdminDashboardScreen';
import ApprovalsScreen from '@screens/ApprovalsScreen';
import AddProjectScreen from '@screens/AddProjectScreen';
import { COLORS } from '@lib/theme';

export type RootStackParamList = {
  Home: undefined;
  PropertyDetails: { propertyId: number };
  ARPropertyView: { 
    propertyId: number;
    modelUrl?: string;
    floorPlanUrl?: string;
  };
  Login: undefined;
  Register: undefined;
  Projects: undefined;
  Blog: undefined;
  SubmitProperty: undefined;
  PropertyForm: { propertyType: string; propertyId?: number };
  AdminDashboard: undefined;
  Approvals: undefined;
  AddProject: undefined;
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
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ title: 'Login' }}
        />
        <Stack.Screen
          name="Register"
          component={RegisterScreen}
          options={{ title: 'Sign Up' }}
        />
        <Stack.Screen
          name="Projects"
          component={ProjectsScreen}
          options={{ title: 'Projects' }}
        />
        <Stack.Screen
          name="Blog"
          component={BlogScreen}
          options={{ title: 'Blog' }}
        />
        <Stack.Screen
          name="SubmitProperty"
          component={SubmitPropertyScreen}
          options={{ title: 'Submit Property' }}
        />
        <Stack.Screen
          name="PropertyForm"
          component={PropertyFormScreen}
          options={{ title: 'Property Form' }}
        />
        <Stack.Screen
          name="AdminDashboard"
          component={AdminDashboardScreen}
          options={{ title: 'Admin Dashboard' }}
        />
        <Stack.Screen
          name="Approvals"
          component={ApprovalsScreen}
          options={{ title: 'Approvals' }}
        />
        <Stack.Screen
          name="AddProject"
          component={AddProjectScreen}
          options={{ title: 'Add Project' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;

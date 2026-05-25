import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

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
import SettingsScreen from '@screens/SettingsScreen';
import PropertiesScreen from '@screens/PropertiesScreen';
import PhoneVerificationScreen from '@screens/PhoneVerificationScreen';
import { COLORS } from '@lib/theme';

export type RootStackParamList = {
  Home: undefined;
  Properties: undefined;
  PropertyDetails: { propertyId: number };
  ARPropertyView: { 
    propertyId: number;
    modelUrl?: string;
    floorPlanUrl?: string;
  };
  Login: undefined;
  Register: undefined;
  PhoneVerification: { phoneNumber: string; onVerified?: () => void };
  Projects: undefined;
  Blog: undefined;
  SubmitProperty: undefined;
  PropertyForm: { propertyType: string; propertyId?: number };
  AdminDashboard: undefined;
  Approvals: undefined;
  AddProject: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator = () => {
  const { t } = useTranslation();

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
          options={{ title: t('app.name') }}
        />
        <Stack.Screen
          name="Properties"
          component={PropertiesScreen}
          options={{ title: t('nav.properties') }}
        />
        <Stack.Screen
          name="PropertyDetails"
          component={PropertyDetailsScreen}
          options={{ title: t('property.details') }}
        />
        <Stack.Screen
          name="ARPropertyView"
          component={ARPropertyViewScreen}
          options={{ 
            title: t('property.arView'),
            headerShown: true,
            animation: 'slide_from_bottom'
          }}
        />
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ title: t('auth.login') }}
        />
        <Stack.Screen
          name="Register"
          component={RegisterScreen}
          options={{ title: t('auth.register') }}
        />
        <Stack.Screen
          name="Projects"
          component={ProjectsScreen}
          options={{ title: t('nav.projects') }}
        />
        <Stack.Screen
          name="Blog"
          component={BlogScreen}
          options={{ title: t('nav.blog') }}
        />
        <Stack.Screen
          name="SubmitProperty"
          component={SubmitPropertyScreen}
          options={{ title: t('property.submit') }}
        />
        <Stack.Screen
          name="PropertyForm"
          component={PropertyFormScreen}
          options={{ title: t('property.submit') }}
        />
        <Stack.Screen
          name="AdminDashboard"
          component={AdminDashboardScreen}
          options={{ title: t('admin.dashboard') }}
        />
        <Stack.Screen
          name="Approvals"
          component={ApprovalsScreen}
          options={{ title: t('admin.approvals') }}
        />
        <Stack.Screen
          name="AddProject"
          component={AddProjectScreen}
          options={{ title: t('admin.addProject') }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: t('nav.settings') }}
        />
        <Stack.Screen
          name="PhoneVerification"
          component={PhoneVerificationScreen}
          options={{ title: t('auth.verifyPhone', 'Verify Phone'), headerBackVisible: true }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;

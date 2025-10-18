import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@navigation/AppNavigator';
import { useAuth } from '@/contexts/AuthContext';
import { COLORS, SPACING } from '@lib/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SubmitProperty'>;

const PROPERTY_TYPES = {
  APARTMENT: 'apartment',
  VILLA: 'villa',
  LAND: 'land',
  COMMERCIAL: 'commercial',
  PROJECT: 'project',
};

const SubmitPropertyScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { user } = useAuth();

  const canAddOffPlan =
    user?.email === 'info@kinglikeluxury.com' || user?.email === 'tarekalimam@gmail.com';

  const propertyTypes = [
    {
      type: PROPERTY_TYPES.APARTMENT,
      title: 'Apartments',
      description: 'Condos, penthouses, and apartment units',
      icon: '🏢',
      available: true,
    },
    {
      type: PROPERTY_TYPES.VILLA,
      title: 'Villas',
      description: 'Standalone houses, villas, and townhouses',
      icon: '🏠',
      available: true,
    },
    {
      type: PROPERTY_TYPES.LAND,
      title: 'Land',
      description: 'Empty plots, agricultural land, and lots',
      icon: '🏞️',
      available: true,
    },
    {
      type: PROPERTY_TYPES.COMMERCIAL,
      title: 'Commercial',
      description: 'Offices, retail spaces, and warehouses',
      icon: '🏪',
      available: true,
    },
    ...(canAddOffPlan
      ? [
          {
            type: PROPERTY_TYPES.PROJECT,
            title: 'Off-Plan Projects',
            description: 'Pre-construction developments and projects',
            icon: '📄',
            available: true,
          },
        ]
      : []),
  ];

  const handlePropertyTypeSelect = (type: string) => {
    navigation.navigate('PropertyForm', { propertyType: type });
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.authRequired}>
          <Text style={styles.authTitle}>Authentication Required</Text>
          <Text style={styles.authMessage}>Please log in to submit a property</Text>
          <TouchableOpacity
            style={styles.loginButton}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.loginButtonText}>Go to Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Submit a Property</Text>
        <Text style={styles.headerSubtitle}>Choose the type of property you want to list</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {propertyTypes.map((propertyType) => (
          <TouchableOpacity
            key={propertyType.type}
            style={styles.typeCard}
            onPress={() => handlePropertyTypeSelect(propertyType.type)}
            disabled={!propertyType.available}
          >
            <View style={styles.typeIcon}>
              <Text style={styles.iconText}>{propertyType.icon}</Text>
            </View>
            <View style={styles.typeInfo}>
              <Text style={styles.typeTitle}>{propertyType.title}</Text>
              <Text style={styles.typeDescription}>{propertyType.description}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    backgroundColor: COLORS.white,
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.gray,
    marginTop: SPACING.xs,
  },
  scrollContent: {
    padding: SPACING.md,
  },
  typeCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  typeIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  iconText: {
    fontSize: 32,
  },
  typeInfo: {
    flex: 1,
  },
  typeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  typeDescription: {
    fontSize: 14,
    color: COLORS.gray,
  },
  arrow: {
    fontSize: 32,
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  authRequired: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  authMessage: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: 8,
  },
  loginButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default SubmitPropertyScreen;

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@navigation/AppNavigator';
import { useAuth } from '@/contexts/AuthContext';
import { submitProject } from '@lib/api';
import { COLORS, SPACING } from '@lib/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddProject'>;

const AddProjectScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { user } = useAuth();

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    developer: '',
    completionDate: '',
    projectStatus: 'Now Selling',
    price: '',
    location: '',
    area: '',
  });

  const [loading, setLoading] = useState(false);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (
      !formData.title ||
      !formData.description ||
      !formData.developer ||
      !formData.completionDate ||
      !formData.price ||
      !formData.location ||
      !formData.area
    ) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      const projectData = {
        title: formData.title,
        description: formData.description,
        developer: formData.developer,
        completionDate: formData.completionDate,
        projectStatus: formData.projectStatus,
        price: parseInt(formData.price),
        location: formData.location,
        area: parseInt(formData.area),
        propertyType: 'project',
        images: [],
        videos: [],
        features: [],
        amenities: [],
        ownerId: user?.id,
      };

      await submitProject(projectData);
      Alert.alert('Success', 'Project added successfully!', [
        {
          text: 'OK',
          onPress: () => navigation.navigate('Projects'),
        },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add project');
    } finally {
      setLoading(false);
    }
  };

  if (!user?.isAdmin) {
    return (
      <View style={styles.container}>
        <View style={styles.accessDenied}>
          <Text style={styles.accessDeniedText}>Access Denied</Text>
          <Text style={styles.accessDeniedSubtext}>
            You do not have permission to view this page
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Add Construction Project</Text>
        <Text style={styles.headerSubtitle}>Add a new off-plan project</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Project Title *</Text>
          <TextInput
            style={styles.input}
            placeholder="Project title"
            value={formData.title}
            onChangeText={(value) => handleInputChange('title', value)}
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Developer *</Text>
          <TextInput
            style={styles.input}
            placeholder="Developer name"
            value={formData.developer}
            onChangeText={(value) => handleInputChange('developer', value)}
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Description *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Project description"
            value={formData.description}
            onChangeText={(value) => handleInputChange('description', value)}
            multiline
            numberOfLines={4}
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Completion Date *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Q4 2024"
            value={formData.completionDate}
            onChangeText={(value) => handleInputChange('completionDate', value)}
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Project Status *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Now Selling, Pre-Launch"
            value={formData.projectStatus}
            onChangeText={(value) => handleInputChange('projectStatus', value)}
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Starting Price *</Text>
          <TextInput
            style={styles.input}
            placeholder="Starting price"
            value={formData.price}
            onChangeText={(value) => handleInputChange('price', value)}
            keyboardType="numeric"
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Location *</Text>
          <TextInput
            style={styles.input}
            placeholder="Location"
            value={formData.location}
            onChangeText={(value) => handleInputChange('location', value)}
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Total Area (m²) *</Text>
          <TextInput
            style={styles.input}
            placeholder="Total area"
            value={formData.area}
            onChangeText={(value) => handleInputChange('area', value)}
            keyboardType="numeric"
            editable={!loading}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.submitButtonText}>Add Project</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingBottom: SPACING.xl,
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
  form: {
    padding: SPACING.lg,
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: SPACING.md,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  accessDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  accessDeniedText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  accessDeniedSubtext: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: 'center',
  },
});

export default AddProjectScreen;

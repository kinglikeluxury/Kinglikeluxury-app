import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@navigation/AppNavigator';
import { getProjects } from '@lib/api';
import { COLORS, FONTS, SPACING } from '@lib/theme';

type ProjectItem = {
  id: number;
  propertyId: number;
  developer: string;
  completionDate: string;
  projectStatus: string;
  property: {
    id: number;
    title: string;
    description: string;
    price: number;
    location: string;
    area: number;
    images: string[];
    bedrooms?: number;
    bathrooms?: number;
  };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Projects'>;

const ProjectsScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const data = await getProjects();
      setProjects(data);
      setFilteredProjects(data);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProjects();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredProjects(projects);
    } else {
      const filtered = projects.filter(
        (project) =>
          project.property.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          project.developer.toLowerCase().includes(searchTerm.toLowerCase()) ||
          project.property.location.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredProjects(filtered);
    }
  }, [searchTerm, projects]);

  const renderProject = ({ item }: { item: ProjectItem }) => (
    <TouchableOpacity
      style={styles.projectCard}
      onPress={() => navigation.navigate('PropertyDetails', { propertyId: item.propertyId })}
    >
      <Image
        source={{
          uri: item.property.images?.[0] || 'https://via.placeholder.com/300x200',
        }}
        style={styles.projectImage}
        resizeMode="cover"
      />
      <View style={styles.statusBadge}>
        <Text style={styles.statusText}>{item.projectStatus}</Text>
      </View>
      <View style={styles.projectInfo}>
        <Text style={styles.projectTitle}>{item.property.title}</Text>
        <Text style={styles.developer}>by {item.developer}</Text>
        <Text style={styles.projectLocation}>{item.property.location}</Text>
        <View style={styles.projectDetails}>
          <Text style={styles.projectPrice}>${item.property.price.toLocaleString()}</Text>
          <Text style={styles.completionDate}>Completion: {item.completionDate}</Text>
        </View>
        {(item.property.bedrooms || item.property.bathrooms) && (
          <View style={styles.propertyFeatures}>
            {item.property.bedrooms && (
              <Text style={styles.feature}>{item.property.bedrooms} Beds</Text>
            )}
            {item.property.bathrooms && (
              <Text style={styles.feature}>{item.property.bathrooms} Baths</Text>
            )}
            <Text style={styles.feature}>{item.property.area} m²</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Construction Projects</Text>
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search projects..."
            placeholderTextColor={COLORS.gray}
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
        </View>
      </View>

      <FlatList
        data={filteredProjects}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderProject}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {searchTerm ? 'No projects match your search' : 'No projects available'}
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    marginBottom: SPACING.md,
  },
  searchContainer: {
    marginTop: SPACING.sm,
  },
  searchInput: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: SPACING.md,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  listContainer: {
    padding: SPACING.md,
  },
  projectCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: SPACING.lg,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  projectImage: {
    width: '100%',
    height: 200,
  },
  statusBadge: {
    position: 'absolute',
    top: SPACING.md,
    right: SPACING.md,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 6,
  },
  statusText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 12,
  },
  projectInfo: {
    padding: SPACING.lg,
  },
  projectTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  developer: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  projectLocation: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: SPACING.md,
  },
  projectDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  projectPrice: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  completionDate: {
    fontSize: 12,
    color: COLORS.gray,
  },
  propertyFeatures: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
  },
  feature: {
    fontSize: 12,
    color: COLORS.gray,
    marginRight: SPACING.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xl * 2,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray,
  },
});

export default ProjectsScreen;

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  ImageBackground,
  TextInput,
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import FastImage from 'react-native-fast-image';
import { getProperties, getProjects } from '../lib/api';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS } from '../lib/theme';
import PropertyCard from '../components/property/PropertyCard';
import Button from '../components/ui/Button';

// Mock categories - would be fetched from API
const categories = [
  {
    id: 1,
    name: 'Apartments',
    image: require('../assets/1702663538423.jfif'),
    type: 'apartment',
    count: '120+ Listings',
  },
  {
    id: 2,
    name: 'Villas',
    image: require('../assets/LUXURY_20230822_234540_0000-removebg.png'),
    type: 'villa',
    count: '85+ Listings',
  },
  {
    id: 3,
    name: 'Lands',
    image: require('../assets/1702663538423.jfif'),
    type: 'land',
    count: '63+ Listings',
  },
  {
    id: 4,
    name: 'Under Construction',
    image: require('../assets/1702663538423.jfif'),
    type: 'project',
    count: '42+ Listings',
    isProject: true,
  },
];

const HomeScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [featuredProperties, setFeaturedProperties] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPropertyType, setSelectedPropertyType] = useState('all');
  const [selectedLocation, setSelectedLocation] = useState('');

  useEffect(() => {
    // In a real app, these would be API calls
    fetchFeaturedProperties();
  }, []);

  const fetchFeaturedProperties = async () => {
    setLoading(true);
    try {
      // In a real implementation, we would call the API
      // const response = await getProperties({ featured: true });
      // setFeaturedProperties(response);
      
      // Mock data for demo
      setFeaturedProperties([
        {
          id: 1,
          title: 'Modern Apartment in City Center',
          location: 'Batumi, Georgia',
          price: 120000,
          area: 85,
          bedrooms: 2,
          bathrooms: 1,
          propertyType: 'apartment',
          images: ['https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80'],
          status: 'approved',
          isFeatured: true,
        },
        {
          id: 2,
          title: 'Luxury Villa with Sea View',
          location: 'Istanbul, Turkey',
          price: 580000,
          area: 220,
          bedrooms: 4,
          bathrooms: 3,
          propertyType: 'villa',
          images: ['https://images.unsplash.com/photo-1613490493576-7fde63acd811?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80'],
          status: 'approved',
          isFeatured: true,
        },
        {
          id: 3,
          title: 'Premium Land Plot',
          location: 'Tbilisi, Georgia',
          price: 85000,
          area: 1200,
          bedrooms: null,
          bathrooms: null,
          propertyType: 'land',
          images: ['https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80'],
          status: 'approved',
          isFeatured: true,
        },
      ]);
    } catch (error) {
      console.error('Error fetching featured properties:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    // @ts-ignore
    navigation.navigate('Properties', {
      query: searchQuery,
      propertyType: selectedPropertyType,
      location: selectedLocation,
    });
  };

  const handleCategoryPress = (category) => {
    // @ts-ignore
    navigation.navigate('Properties', {
      propertyType: category.type,
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={COLORS.primary} barStyle="light-content" />
      
      {/* Header with Logo */}
      <View style={styles.header}>
        <View>
          <Text style={styles.logoText}>KINGLIKE</Text>
          <Text style={styles.logoSubtext}>LUXURY</Text>
        </View>
        <TouchableOpacity 
          // @ts-ignore
          onPress={() => navigation.navigate('Login')}
          style={styles.loginButton}
        >
          <Text style={styles.loginButtonText}>Login</Text>
        </TouchableOpacity>
      </View>
      
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>Find Your Perfect Property</Text>
            <Text style={styles.heroSubtitle}>
              Discover apartments, villas, lands and construction projects
            </Text>
            
            {/* Search Bar */}
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search properties..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholderTextColor={COLORS.gray[400]}
              />
              <Button 
                title="Search" 
                size="sm" 
                style={styles.searchButton}
                onPress={handleSearch}
              />
            </View>
          </View>
        </View>
        
        {/* Categories Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Browse by category</Text>
            <View style={styles.exclusiveBadge}>
              <Text style={styles.exclusiveBadgeText}>KINGLIKE EXCLUSIVE</Text>
            </View>
          </View>
          
          <FlatList
            data={categories}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.categoriesContainer}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.categoryCard}
                onPress={() => handleCategoryPress(item)}
              >
                <ImageBackground
                  source={item.image}
                  style={styles.categoryImage}
                  imageStyle={styles.categoryImageStyle}
                >
                  <View style={styles.categoryOverlay}>
                    {item.isProject && (
                      <View style={styles.projectOverlay}>
                        <Text style={styles.kinglikeText}>KINGLIKE</Text>
                        <Text style={[styles.kinglikeText, {color: COLORS.primary}]}>LUXURY</Text>
                        <View style={styles.comingSoonBadge}>
                          <Text style={styles.comingSoonText}>Coming Soon</Text>
                        </View>
                      </View>
                    )}
                    <View style={styles.categoryTextContainer}>
                      <Text style={styles.categoryName}>{item.name}</Text>
                      <Text style={styles.categoryCount}>{item.count}</Text>
                    </View>
                  </View>
                </ImageBackground>
              </TouchableOpacity>
            )}
          />
        </View>
        
        {/* Featured Properties Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Featured Properties</Text>
            <TouchableOpacity 
              // @ts-ignore
              onPress={() => navigation.navigate('Properties', { featured: true })}
            >
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          
          {loading ? (
            <ActivityIndicator size="large" color={COLORS.primary} />
          ) : (
            <FlatList
              data={featuredProperties}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id.toString()}
              contentContainerStyle={styles.propertiesContainer}
              renderItem={({ item }) => (
                <View style={styles.featuredPropertyCard}>
                  <PropertyCard {...item} />
                </View>
              )}
            />
          )}
        </View>
        
        {/* CTA Section */}
        <View style={styles.ctaContainer}>
          <Text style={styles.ctaTitle}>Ready to find your dream property?</Text>
          <Text style={styles.ctaSubtitle}>
            Browse our extensive collection or list your own property
          </Text>
          <View style={styles.ctaButtons}>
            <Button 
              title="Browse Properties" 
              style={styles.ctaButton}
              // @ts-ignore
              onPress={() => navigation.navigate('Properties')}
            />
            <Button 
              title="Submit Property" 
              variant="outline" 
              style={[styles.ctaButton, styles.ctaSecondaryButton]}
              // @ts-ignore
              onPress={() => navigation.navigate('Login')}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING[4],
    paddingTop: SPACING[4],
    paddingBottom: SPACING[2],
    backgroundColor: COLORS.white,
    ...SHADOWS.sm,
  },
  logoText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.secondary,
  },
  logoSubtext: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  loginButton: {
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
    backgroundColor: COLORS.secondary,
    borderRadius: BORDER_RADIUS.md,
  },
  loginButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 14,
  },
  heroSection: {
    height: 200,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING[4],
  },
  heroContent: {
    width: '100%',
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING[2],
  },
  heroSubtitle: {
    fontSize: 14,
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING[4],
    opacity: 0.9,
  },
  searchContainer: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[1],
    ...SHADOWS.md,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: COLORS.gray[800],
  },
  searchButton: {
    marginLeft: SPACING[2],
  },
  sectionContainer: {
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[5],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING[4],
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.gray[800],
  },
  exclusiveBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING[2],
    paddingVertical: SPACING[1],
    borderRadius: BORDER_RADIUS.full,
  },
  exclusiveBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: 'bold',
  },
  viewAllText: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  categoriesContainer: {
    paddingRight: SPACING[4],
  },
  categoryCard: {
    width: 150,
    height: 100,
    marginRight: SPACING[3],
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    ...SHADOWS.md,
  },
  categoryImage: {
    width: '100%',
    height: '100%',
  },
  categoryImageStyle: {
    borderRadius: BORDER_RADIUS.lg,
  },
  categoryOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
    padding: SPACING[2],
  },
  projectOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  kinglikeText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 14,
  },
  comingSoonBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING[2],
    paddingVertical: SPACING[1],
    borderRadius: BORDER_RADIUS.full,
    marginTop: SPACING[2],
    transform: [{ rotate: '-5deg' }],
  },
  comingSoonText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: 'bold',
  },
  categoryTextContainer: {
    zIndex: 10,
  },
  categoryName: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 14,
  },
  categoryCount: {
    color: COLORS.white,
    fontSize: 12,
    opacity: 0.8,
  },
  propertiesContainer: {
    paddingRight: SPACING[4],
  },
  featuredPropertyCard: {
    width: 220,
    marginRight: SPACING[3],
  },
  ctaContainer: {
    padding: SPACING[5],
    backgroundColor: COLORS.gray[100],
    borderRadius: BORDER_RADIUS.lg,
    margin: SPACING[4],
    alignItems: 'center',
  },
  ctaTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.secondary,
    marginBottom: SPACING[2],
    textAlign: 'center',
  },
  ctaSubtitle: {
    fontSize: 14,
    color: COLORS.gray[600],
    marginBottom: SPACING[4],
    textAlign: 'center',
  },
  ctaButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  ctaButton: {
    minWidth: 150,
    margin: SPACING[2],
  },
  ctaSecondaryButton: {
    borderColor: COLORS.primary,
  },
});

export default HomeScreen;
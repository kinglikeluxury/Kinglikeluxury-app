import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Linking,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { useRoute, useNavigation } from '@react-navigation/native';
import { getProperty } from '../lib/api';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS } from '../lib/theme';
import Button from '../components/ui/Button';

const { width } = Dimensions.get('window');

const PropertyDetailsScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { id } = route.params as { id: number };
  
  const [loading, setLoading] = useState(true);
  const [property, setProperty] = useState<any>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    fetchPropertyDetails();
  }, [id]);

  const fetchPropertyDetails = async () => {
    setLoading(true);
    try {
      // In a real implementation, we would call the API
      // const data = await getProperty(id);
      // setProperty(data);
      
      // Mock data for demo
      setTimeout(() => {
        setProperty({
          id: 1,
          title: 'Modern Apartment in City Center',
          location: 'Batumi, Georgia',
          price: 120000,
          area: 85,
          bedrooms: 2,
          bathrooms: 1,
          description: 'A beautiful modern apartment located in the heart of Batumi. Features include a spacious living room, fully equipped kitchen, balcony with city views, and 24/7 security. Walking distance to the beach, restaurants, and shopping.',
          propertyType: 'apartment',
          images: [
            'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
          ],
          features: [
            'Central Heating',
            'Air Conditioning',
            'Elevator',
            'High-speed Internet',
            'Parking Space',
            'Swimming Pool',
            'Security System'
          ],
          status: 'approved',
          ownerPhone: '+995 555 12 34 56',
          ownerEmail: 'owner@example.com',
          createdAt: '2023-10-15T09:00:00.000Z',
          floorNumber: 4,
          totalFloors: 8,
          latitude: 41.6462,
          longitude: 41.6420,
        });
        setLoading(false);
      }, 1000);
    } catch (error) {
      console.error('Error fetching property details:', error);
      setLoading(false);
    }
  };

  const handleContactOwner = () => {
    // In a real app, this would open a dialog or modal
    // For this demo, we'll just simulate dialing the number
    if (property?.ownerPhone) {
      Linking.openURL(`tel:${property.ownerPhone}`);
    }
  };

  const handleEmailOwner = () => {
    if (property?.ownerEmail) {
      Linking.openURL(`mailto:${property.ownerEmail}?subject=Inquiry about property ${property.title}`);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading property details...</Text>
      </View>
    );
  }

  if (!property) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Property not found</Text>
        <Button
          title="Go Back"
          onPress={() => navigation.goBack()}
          style={styles.errorButton}
        />
      </View>
    );
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Image Gallery */}
      <View style={styles.imageContainer}>
        <FastImage
          source={{ uri: property.images[selectedImageIndex] }}
          style={styles.mainImage}
          resizeMode={FastImage.resizeMode.cover}
        />
        
        {/* Project badge if applicable */}
        {property.propertyType === 'project' && (
          <View style={styles.projectBadge}>
            <Text style={styles.badgeText}>Under Construction</Text>
          </View>
        )}
        
        {/* Thumbnail Carousel */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.thumbnailContainer}
        >
          {property.images.map((image: string, index: number) => (
            <TouchableOpacity
              key={index}
              onPress={() => setSelectedImageIndex(index)}
              style={[
                styles.thumbnailWrapper,
                selectedImageIndex === index && styles.selectedThumbnail,
              ]}
            >
              <FastImage
                source={{ uri: image }}
                style={styles.thumbnail}
                resizeMode={FastImage.resizeMode.cover}
              />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      
      {/* Property Details */}
      <View style={styles.detailsContainer}>
        <Text style={styles.price}>${property.price.toLocaleString()}</Text>
        <Text style={styles.title}>{property.title}</Text>
        <Text style={styles.location}>{property.location}</Text>
        
        {/* Key Features */}
        <View style={styles.keyFeaturesContainer}>
          <View style={styles.keyFeature}>
            <Text style={styles.keyFeatureValue}>{property.area}</Text>
            <Text style={styles.keyFeatureLabel}>m²</Text>
          </View>
          
          {property.bedrooms !== null && (
            <View style={styles.keyFeature}>
              <Text style={styles.keyFeatureValue}>{property.bedrooms}</Text>
              <Text style={styles.keyFeatureLabel}>Beds</Text>
            </View>
          )}
          
          {property.bathrooms !== null && (
            <View style={styles.keyFeature}>
              <Text style={styles.keyFeatureValue}>{property.bathrooms}</Text>
              <Text style={styles.keyFeatureLabel}>Baths</Text>
            </View>
          )}
          
          {property.floorNumber !== null && (
            <View style={styles.keyFeature}>
              <Text style={styles.keyFeatureValue}>{property.floorNumber}/{property.totalFloors}</Text>
              <Text style={styles.keyFeatureLabel}>Floor</Text>
            </View>
          )}
        </View>
        
        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{property.description}</Text>
        </View>
        
        {/* Features */}
        {property.features && property.features.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Features</Text>
            <View style={styles.featuresContainer}>
              {property.features.map((feature: string, index: number) => (
                <View key={index} style={styles.feature}>
                  <Text style={styles.featureText}>{feature}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        
        {/* Date */}
        <View style={styles.dateContainer}>
          <Text style={styles.dateText}>
            Listed on {formatDate(property.createdAt)}
          </Text>
        </View>
        
        {/* Contact Buttons */}
        <View style={styles.contactContainer}>
          <Button
            title="Call Owner"
            style={styles.contactButton}
            onPress={handleContactOwner}
          />
          <Button
            title="Email"
            variant="outline"
            style={styles.contactButton}
            onPress={handleEmailOwner}
          />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  loadingText: {
    marginTop: SPACING[2],
    color: COLORS.gray[600],
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING[5],
  },
  errorText: {
    fontSize: 16,
    color: COLORS.gray[700],
    marginBottom: SPACING[3],
  },
  errorButton: {
    width: 150,
  },
  imageContainer: {
    position: 'relative',
  },
  mainImage: {
    width,
    height: width * 0.75,
  },
  projectBadge: {
    position: 'absolute',
    top: SPACING[3],
    left: SPACING[3],
    backgroundColor: COLORS.secondary,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[1],
    borderRadius: BORDER_RADIUS.full,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  thumbnailContainer: {
    position: 'absolute',
    bottom: SPACING[3],
    left: 0,
    right: 0,
    paddingHorizontal: SPACING[3],
  },
  thumbnailWrapper: {
    width: 60,
    height: 60,
    marginRight: SPACING[2],
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedThumbnail: {
    borderColor: COLORS.primary,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  detailsContainer: {
    padding: SPACING[4],
  },
  price: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.secondary,
    marginBottom: SPACING[1],
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.gray[800],
    marginBottom: SPACING[1],
  },
  location: {
    fontSize: 14,
    color: COLORS.gray[600],
    marginBottom: SPACING[3],
  },
  keyFeaturesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.gray[200],
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING[3],
    marginBottom: SPACING[4],
  },
  keyFeature: {
    alignItems: 'center',
  },
  keyFeatureValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.gray[800],
  },
  keyFeatureLabel: {
    fontSize: 12,
    color: COLORS.gray[600],
    marginTop: SPACING[1],
  },
  section: {
    marginBottom: SPACING[4],
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.gray[800],
    marginBottom: SPACING[2],
  },
  description: {
    fontSize: 14,
    lineHeight: 24,
    color: COLORS.gray[700],
  },
  featuresContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  feature: {
    backgroundColor: COLORS.gray[100],
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
    borderRadius: BORDER_RADIUS.full,
    marginRight: SPACING[2],
    marginBottom: SPACING[2],
  },
  featureText: {
    fontSize: 12,
    color: COLORS.gray[700],
  },
  dateContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[200],
    paddingVertical: SPACING[3],
    marginBottom: SPACING[3],
  },
  dateText: {
    fontSize: 12,
    color: COLORS.gray[500],
    textAlign: 'center',
  },
  contactContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  contactButton: {
    flex: 1,
    marginHorizontal: SPACING[1],
  },
});

export default PropertyDetailsScreen;
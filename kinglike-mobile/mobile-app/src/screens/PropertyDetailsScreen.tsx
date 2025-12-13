import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Dimensions,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '@navigation/AppNavigator';
import { getProperty } from '@lib/api';
import { COLORS, FONTS, SPACING } from '@lib/theme';

type PropertyDetailsRouteProp = RouteProp<RootStackParamList, 'PropertyDetails'>;

type PropertyDetail = {
  id: number;
  title: string;
  description: string;
  location: string;
  price: number;
  propertyType: string;
  status: string;
  area: number;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floorNumber?: number | null;
  images: string[];
  ownerId: number;
  owner?: {
    username: string;
    email: string;
    phoneNumber: string;
  };
};

const { width } = Dimensions.get('window');

const PropertyDetailsScreen = () => {
  const route = useRoute<PropertyDetailsRouteProp>();
  const { propertyId } = route.params;
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    const fetchPropertyDetails = async () => {
      try {
        setLoading(true);
        const data = await getProperty(propertyId);
        setProperty(data);
      } catch (error) {
        console.error('Error fetching property details:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPropertyDetails();
  }, [propertyId]);

  const handleContact = async (contactType: 'phone' | 'email') => {
    if (!property?.owner) return;

    if (contactType === 'phone' && property.owner.phoneNumber) {
      await Linking.openURL(`tel:${property.owner.phoneNumber}`);
    } else if (contactType === 'email' && property.owner.email) {
      await Linking.openURL(`mailto:${property.owner.email}`);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!property) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Property not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.imageContainer}>
        {property.images && property.images.length > 0 ? (
          <>
            <Image
              source={{ uri: property.images[currentImageIndex] }}
              style={styles.mainImage}
              resizeMode="cover"
            />
            <View style={styles.thumbnailContainer}>
              {property.images.map((img, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => setCurrentImageIndex(index)}
                  style={[
                    styles.thumbnailWrapper,
                    currentImageIndex === index && styles.activeThumbnail,
                  ]}
                >
                  <Image
                    source={{ uri: img }}
                    style={styles.thumbnail}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <Image
            source={{ uri: 'https://via.placeholder.com/400x300' }}
            style={styles.mainImage}
            resizeMode="cover"
          />
        )}
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{property.title}</Text>
        <Text style={styles.location}>{property.location}</Text>
        <Text style={styles.price}>${property.price.toLocaleString()}</Text>

        <View style={styles.infoContainer}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Type</Text>
            <Text style={styles.infoValue}>{property.propertyType}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Status</Text>
            <Text style={styles.infoValue}>{property.status}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Area</Text>
            <Text style={styles.infoValue}>{property.area} m²</Text>
          </View>
        </View>

        {(property.bedrooms != null ||
          property.bathrooms != null ||
          property.floorNumber != null) && (
          <View style={styles.infoContainer}>
            {property.bedrooms != null && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Bedrooms</Text>
                <Text style={styles.infoValue}>{property.bedrooms}</Text>
              </View>
            )}
            {property.bathrooms != null && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Bathrooms</Text>
                <Text style={styles.infoValue}>{property.bathrooms}</Text>
              </View>
            )}
            {property.floorNumber != null && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Floor</Text>
                <Text style={styles.infoValue}>{property.floorNumber}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{property.description}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Virtual Tour</Text>
          <TouchableOpacity
            style={styles.arButton}
            onPress={() => navigation.navigate('ARPropertyView', { 
              propertyId: property.id,
              floorPlanUrl: 'https://kinglikeluxury.com/floor-plans/' + property.id + '.glb' 
            })}
          >
            <Text style={styles.arButtonText}>View in AR</Text>
          </TouchableOpacity>
          <Text style={styles.arDescription}>
            Experience the property in augmented reality. See the floor plan and layout in 3D.
          </Text>
        </View>

        {property.owner && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            <Text style={styles.contactName}>{property.owner.username}</Text>
            <View style={styles.contactButtons}>
              {property.owner.phoneNumber && (
                <TouchableOpacity
                  style={styles.contactButton}
                  onPress={() => handleContact('phone')}
                >
                  <Text style={styles.contactButtonText}>Call</Text>
                </TouchableOpacity>
              )}
              {property.owner.email && (
                <TouchableOpacity
                  style={[styles.contactButton, styles.emailButton]}
                  onPress={() => handleContact('email')}
                >
                  <Text style={styles.contactButtonText}>Email</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
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
  errorText: {
    fontSize: FONTS.sizes.medium,
    color: COLORS.error,
  },
  imageContainer: {
    width: '100%',
    backgroundColor: COLORS.white,
  },
  mainImage: {
    width: '100%',
    height: 250,
    backgroundColor: COLORS.lightGray,
  },
  thumbnailContainer: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: SPACING.small,
  },
  thumbnailWrapper: {
    width: width / 5 - SPACING.small * 2,
    height: width / 5 - SPACING.small * 2,
    marginRight: SPACING.small,
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  activeThumbnail: {
    borderColor: COLORS.primary,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.lightGray,
  },
  content: {
    padding: SPACING.medium,
  },
  title: {
    fontSize: FONTS.sizes.xlarge,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  location: {
    fontSize: FONTS.sizes.small,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  price: {
    fontSize: FONTS.sizes.large,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: SPACING.medium,
  },
  infoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: SPACING.medium,
    marginBottom: SPACING.medium,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  infoItem: {
    alignItems: 'center',
    flex: 1,
  },
  infoLabel: {
    fontSize: FONTS.sizes.xsmall,
    color: COLORS.textLight,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: FONTS.sizes.medium,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  section: {
    marginBottom: SPACING.large,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.medium,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.small,
  },
  description: {
    fontSize: FONTS.sizes.small,
    lineHeight: 22,
    color: COLORS.text,
  },
  contactName: {
    fontSize: FONTS.sizes.medium,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.small,
  },
  contactButtons: {
    flexDirection: 'row',
  },
  contactButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    borderRadius: 5,
    marginRight: SPACING.small,
  },
  emailButton: {
    backgroundColor: COLORS.secondary,
  },
  contactButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: FONTS.sizes.small,
  },
  arButton: {
    backgroundColor: COLORS.secondary,
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.medium,
    borderRadius: 8,
    marginBottom: SPACING.small,
    alignItems: 'center',
  },
  arButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: FONTS.sizes.medium,
  },
  arDescription: {
    fontSize: FONTS.sizes.small,
    color: COLORS.textLight,
    lineHeight: 20,
  },
});

export default PropertyDetailsScreen;
import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions 
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS } from '../../lib/theme';

// Get screen width to determine the card width
const { width } = Dimensions.get('window');
const cardWidth = width / 2 - SPACING[6];

interface PropertyCardProps {
  id: number;
  title: string;
  location: string;
  price: number;
  area: number;
  bedrooms?: number | null;
  bathrooms?: number | null;
  propertyType: string;
  images: string[];
  status: string;
  isFeatured?: boolean;
}

const PropertyCard: React.FC<PropertyCardProps> = ({
  id,
  title,
  location,
  price,
  area,
  bedrooms,
  bathrooms,
  propertyType,
  images,
  status,
  isFeatured = false,
}) => {
  const navigation = useNavigation();

  const handlePress = () => {
    // @ts-ignore - Navigation typing is complex in this simple example
    navigation.navigate('PropertyDetails', { id });
  };

  const formatPrice = (price: number) => {
    if (price >= 1000000) {
      return `$${(price / 1000000).toFixed(1)}M`;
    } else if (price >= 1000) {
      return `$${(price / 1000).toFixed(0)}K`;
    }
    return `$${price}`;
  };

  return (
    <TouchableOpacity 
      style={[
        styles.container, 
        isFeatured && styles.featuredContainer,
        SHADOWS.md
      ]} 
      onPress={handlePress}
    >
      <View style={styles.imageContainer}>
        <FastImage
          source={{
            uri: images && images.length > 0
              ? images[0]
              : 'https://via.placeholder.com/300x200?text=No+Image',
          }}
          style={styles.image}
          resizeMode={FastImage.resizeMode.cover}
        />
        {status === 'pending' && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>Pending</Text>
          </View>
        )}
        {propertyType === 'project' && (
          <View style={styles.projectBadge}>
            <Text style={styles.badgeText}>Under Construction</Text>
          </View>
        )}
        {isFeatured && (
          <View style={styles.featuredBadge}>
            <Text style={styles.badgeText}>Featured</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        <Text style={styles.price}>{formatPrice(price)}</Text>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.location} numberOfLines={1}>{location}</Text>
        
        <View style={styles.featuresContainer}>
          {bedrooms !== null && bedrooms !== undefined && (
            <View style={styles.feature}>
              <Text style={styles.featureText}>{bedrooms} bed</Text>
            </View>
          )}
          {bathrooms !== null && bathrooms !== undefined && (
            <View style={styles.feature}>
              <Text style={styles.featureText}>{bathrooms} bath</Text>
            </View>
          )}
          <View style={styles.feature}>
            <Text style={styles.featureText}>{area} m²</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: cardWidth,
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    marginBottom: SPACING[4],
  },
  featuredContainer: {
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  imageContainer: {
    position: 'relative',
    height: 140,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  pendingBadge: {
    position: 'absolute',
    top: SPACING[2],
    right: SPACING[2],
    backgroundColor: COLORS.warning,
    paddingHorizontal: SPACING[2],
    paddingVertical: SPACING[1],
    borderRadius: BORDER_RADIUS.full,
  },
  pendingText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: 'bold',
  },
  projectBadge: {
    position: 'absolute',
    top: SPACING[2],
    left: SPACING[2],
    backgroundColor: COLORS.secondary,
    paddingHorizontal: SPACING[2],
    paddingVertical: SPACING[1],
    borderRadius: BORDER_RADIUS.full,
  },
  featuredBadge: {
    position: 'absolute',
    bottom: SPACING[2],
    left: SPACING[2],
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING[2],
    paddingVertical: SPACING[1],
    borderRadius: BORDER_RADIUS.full,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: 'bold',
  },
  content: {
    padding: SPACING[3],
  },
  price: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.secondary,
    marginBottom: SPACING[1],
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.gray[800],
    marginBottom: SPACING[1],
  },
  location: {
    fontSize: 12,
    color: COLORS.gray[500],
    marginBottom: SPACING[2],
  },
  featuresContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    flexWrap: 'wrap',
  },
  feature: {
    backgroundColor: COLORS.gray[100],
    paddingHorizontal: SPACING[2],
    paddingVertical: SPACING[1],
    borderRadius: BORDER_RADIUS.full,
    marginRight: SPACING[1],
    marginBottom: SPACING[1],
  },
  featureText: {
    fontSize: 10,
    color: COLORS.gray[700],
  },
});

export default PropertyCard;
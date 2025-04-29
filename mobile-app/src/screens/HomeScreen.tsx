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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@navigation/AppNavigator';
import { getProperties } from '@lib/api';
import { COLORS, FONTS, SPACING } from '@lib/theme';

type PropertyItem = {
  id: number;
  title: string;
  location: string;
  price: number;
  propertyType: string;
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const HomeScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProperties = async () => {
    try {
      setLoading(true);
      const data = await getProperties();
      setProperties(data);
    } catch (error) {
      console.error('Error fetching properties:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProperties();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  const renderProperty = ({ item }: { item: PropertyItem }) => (
    <TouchableOpacity
      style={styles.propertyCard}
      onPress={() => navigation.navigate('PropertyDetails', { propertyId: item.id })}
    >
      <Image
        source={{ uri: item.images?.[0] || 'https://via.placeholder.com/300x200' }}
        style={styles.propertyImage}
        resizeMode="cover"
      />
      <View style={styles.propertyInfo}>
        <Text style={styles.propertyTitle}>{item.title}</Text>
        <Text style={styles.propertyLocation}>{item.location}</Text>
        <Text style={styles.propertyPrice}>
          ${item.price.toLocaleString()}
        </Text>
        <View style={styles.propertyDetails}>
          {item.bedrooms != null && (
            <Text style={styles.propertyDetail}>{item.bedrooms} Beds</Text>
          )}
          {item.bathrooms != null && (
            <Text style={styles.propertyDetail}>{item.bathrooms} Baths</Text>
          )}
          <Text style={styles.propertyType}>{item.propertyType}</Text>
        </View>
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
      <FlatList
        data={properties}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderProperty}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No properties available</Text>
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
  listContainer: {
    padding: SPACING.medium,
  },
  propertyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    marginBottom: SPACING.medium,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  propertyImage: {
    width: '100%',
    height: 180,
  },
  propertyInfo: {
    padding: SPACING.medium,
  },
  propertyTitle: {
    fontSize: FONTS.sizes.large,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  propertyLocation: {
    fontSize: FONTS.sizes.small,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  propertyPrice: {
    fontSize: FONTS.sizes.medium,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 8,
  },
  propertyDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  propertyDetail: {
    fontSize: FONTS.sizes.small,
    color: COLORS.textLight,
  },
  propertyType: {
    fontSize: FONTS.sizes.small,
    color: COLORS.secondary,
    fontWeight: 'bold',
  },
  emptyContainer: {
    paddingVertical: 50,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FONTS.sizes.medium,
    color: COLORS.textLight,
  },
});

export default HomeScreen;
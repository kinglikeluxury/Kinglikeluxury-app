import { useEffect, useState, useLayoutEffect } from 'react';
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '@navigation/AppNavigator';
import { getProperties } from '@lib/api';
import { COLORS, FONTS, SPACING } from '@lib/theme';
import { useLanguage } from '@contexts/LanguageContext';

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
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={styles.headerButton}
          data-testid="button-settings"
        >
          <Text style={styles.headerButtonText}>⚙️</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

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

  const renderNavButton = (label: string, screen: keyof RootStackParamList) => (
    <TouchableOpacity
      style={styles.navButton}
      onPress={() => navigation.navigate(screen as any)}
      data-testid={`nav-${screen.toLowerCase()}`}
    >
      <Text style={styles.navButtonText}>{label}</Text>
    </TouchableOpacity>
  );

  const renderProperty = ({ item }: { item: PropertyItem }) => (
    <TouchableOpacity
      style={styles.propertyCard}
      onPress={() => navigation.navigate('PropertyDetails', { propertyId: item.id })}
      data-testid={`property-card-${item.id}`}
    >
      <Image
        source={{ uri: item.images?.[0] || 'https://via.placeholder.com/300x200' }}
        style={styles.propertyImage}
        resizeMode="cover"
      />
      <View style={styles.propertyInfo}>
        <Text style={[styles.propertyTitle, isRTL && styles.rtlText]}>{item.title}</Text>
        <Text style={[styles.propertyLocation, isRTL && styles.rtlText]}>{item.location}</Text>
        <Text style={[styles.propertyPrice, isRTL && styles.rtlText]}>
          ${item.price.toLocaleString()}
        </Text>
        <View style={[styles.propertyDetails, isRTL && styles.rtlRow]}>
          {item.bedrooms != null && (
            <Text style={styles.propertyDetail}>{item.bedrooms} {t('property.beds')}</Text>
          )}
          {item.bathrooms != null && (
            <Text style={styles.propertyDetail}>{item.bathrooms} {t('property.baths')}</Text>
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
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.navContainer}
        contentContainerStyle={styles.navContent}
      >
        {renderNavButton(t('nav.properties'), 'Properties')}
        {renderNavButton(t('nav.projects'), 'Projects')}
        {renderNavButton(t('nav.blog'), 'Blog')}
        {renderNavButton(t('nav.submit'), 'SubmitProperty')}
        {renderNavButton(t('nav.login'), 'Login')}
      </ScrollView>

      <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>
        {t('property.featured')}
      </Text>

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
            <Text style={[styles.emptyText, isRTL && styles.rtlText]}>
              {t('property.noResults')}
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
  loadingText: {
    marginTop: SPACING.md,
    color: COLORS.textLight,
    fontSize: FONTS.sizes.medium,
  },
  headerButton: {
    paddingHorizontal: SPACING.md,
  },
  headerButtonText: {
    fontSize: 22,
  },
  navContainer: {
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    maxHeight: 60,
  },
  navContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  navButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    marginRight: SPACING.sm,
  },
  navButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.small,
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: FONTS.sizes.xlarge,
    fontWeight: 'bold',
    color: COLORS.text,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  listContainer: {
    padding: SPACING.md,
  },
  propertyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: SPACING.md,
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
    padding: SPACING.md,
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
    fontSize: FONTS.sizes.large,
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
  rtlText: {
    textAlign: 'right',
  },
  rtlRow: {
    flexDirection: 'row-reverse',
  },
});

export default HomeScreen;

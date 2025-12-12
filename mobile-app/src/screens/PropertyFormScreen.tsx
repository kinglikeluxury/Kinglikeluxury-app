import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  FlatList,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { submitProperty, createPaymentIntent } from '../lib/api';
import { COLORS, SPACING } from '../lib/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'PropertyForm'>;
type RouteProps = RouteProp<RootStackParamList, 'PropertyForm'>;

type ListingType = 'regular' | 'vip' | 'super_vip';

interface MediaFile {
  uri: string;
  type: 'image' | 'video';
  name: string;
}

const LISTING_PRICES = {
  regular: { price: 0, duration: '30 days' },
  vip: { price: 50, duration: '60 days' },
  super_vip: { price: 100, duration: '90 days' },
};

const PropertyFormScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { user } = useAuth();
  const propertyType = route.params?.propertyType || 'apartment';

  const [step, setStep] = useState<'details' | 'media' | 'listing' | 'payment'>('details');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    location: '',
    area: '',
    bedrooms: '',
    bathrooms: '',
    floorNumber: '',
    country: '',
    city: '',
  });

  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [listingType, setListingType] = useState<ListingType>('regular');
  const [loading, setLoading] = useState(false);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddImage = () => {
    const newImage: MediaFile = {
      uri: `https://picsum.photos/400/300?random=${Date.now()}`,
      type: 'image',
      name: `image_${Date.now()}.jpg`,
    };
    setMediaFiles((prev) => [...prev, newImage]);
    Alert.alert(t('common.success'), t('property.imageAdded', 'Image placeholder added. In production, this would open the camera/gallery.'));
  };

  const handleAddVideo = () => {
    const newVideo: MediaFile = {
      uri: 'video_placeholder',
      type: 'video',
      name: `video_${Date.now()}.mp4`,
    };
    setMediaFiles((prev) => [...prev, newVideo]);
    Alert.alert(t('common.success'), t('property.videoAdded', 'Video placeholder added. In production, this would open the video picker.'));
  };

  const handleRemoveMedia = (index: number) => {
    setMediaFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const validateDetailsStep = () => {
    if (!formData.title || !formData.description || !formData.price || !formData.location || !formData.area) {
      Alert.alert(t('common.error'), t('errors.formError'));
      return false;
    }
    return true;
  };

  const validateMediaStep = () => {
    if (mediaFiles.filter((m) => m.type === 'image').length === 0) {
      Alert.alert(t('common.error'), t('property.atLeastOneImage', 'Please add at least one image'));
      return false;
    }
    return true;
  };

  const handleNextStep = () => {
    if (step === 'details' && validateDetailsStep()) {
      setStep('media');
    } else if (step === 'media' && validateMediaStep()) {
      setStep('listing');
    } else if (step === 'listing') {
      if (listingType === 'regular') {
        handleSubmit();
      } else {
        setStep('payment');
      }
    }
  };

  const handlePreviousStep = () => {
    if (step === 'media') setStep('details');
    else if (step === 'listing') setStep('media');
    else if (step === 'payment') setStep('listing');
  };

  const handlePayment = async () => {
    try {
      setLoading(true);
      const amount = LISTING_PRICES[listingType].price;
      await createPaymentIntent({ amount, listingType, propertyType });
      Alert.alert(
        t('common.success'),
        t('payment.successMessage', 'Payment processed successfully!'),
        [{ text: 'OK', onPress: handleSubmit }]
      );
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('payment.error', 'Payment failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      const propertyData = {
        title: formData.title,
        description: formData.description,
        price: parseInt(formData.price),
        location: formData.location,
        area: parseInt(formData.area),
        bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
        bathrooms: formData.bathrooms ? parseInt(formData.bathrooms) : null,
        floorNumber: formData.floorNumber ? parseInt(formData.floorNumber) : null,
        propertyType,
        listingType,
        country: formData.country,
        city: formData.city,
        images: mediaFiles.filter((m) => m.type === 'image').map((m) => m.uri),
        videos: mediaFiles.filter((m) => m.type === 'video').map((m) => m.uri),
        features: [],
        amenities: [],
        ownerId: user?.id,
      };

      await submitProperty(propertyData);
      Alert.alert(t('common.success'), t('property.submitSuccess', 'Property submitted successfully!'), [
        {
          text: 'OK',
          onPress: () => navigation.navigate('Home'),
        },
      ]);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('property.submitError', 'Failed to submit property'));
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{t('auth.loginRequired', 'Please log in to submit a property')}</Text>
        <TouchableOpacity style={styles.loginButton} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.loginButtonText}>{t('auth.login')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderDetailsStep = () => (
    <>
      <View style={styles.inputGroup}>
        <Text style={[styles.label, isRTL && styles.rtlText]}>{t('property.title')} *</Text>
        <TextInput
          style={[styles.input, isRTL && styles.rtlInput]}
          placeholder={t('property.titlePlaceholder', 'Property title')}
          value={formData.title}
          onChangeText={(value) => handleInputChange('title', value)}
          editable={!loading}
          textAlign={isRTL ? 'right' : 'left'}
          data-testid="input-title"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, isRTL && styles.rtlText]}>{t('property.description')} *</Text>
        <TextInput
          style={[styles.input, styles.textArea, isRTL && styles.rtlInput]}
          placeholder={t('property.descriptionPlaceholder', 'Property description')}
          value={formData.description}
          onChangeText={(value) => handleInputChange('description', value)}
          multiline
          numberOfLines={4}
          editable={!loading}
          textAlign={isRTL ? 'right' : 'left'}
          data-testid="input-description"
        />
      </View>

      <View style={styles.row}>
        <View style={[styles.inputGroup, styles.halfWidth]}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{t('property.price')} *</Text>
          <TextInput
            style={[styles.input, isRTL && styles.rtlInput]}
            placeholder="$"
            value={formData.price}
            onChangeText={(value) => handleInputChange('price', value)}
            keyboardType="numeric"
            editable={!loading}
            textAlign={isRTL ? 'right' : 'left'}
            data-testid="input-price"
          />
        </View>

        <View style={[styles.inputGroup, styles.halfWidth]}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{t('property.area')} (m²) *</Text>
          <TextInput
            style={[styles.input, isRTL && styles.rtlInput]}
            placeholder="m²"
            value={formData.area}
            onChangeText={(value) => handleInputChange('area', value)}
            keyboardType="numeric"
            editable={!loading}
            textAlign={isRTL ? 'right' : 'left'}
            data-testid="input-area"
          />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, isRTL && styles.rtlText]}>{t('property.location')} *</Text>
        <TextInput
          style={[styles.input, isRTL && styles.rtlInput]}
          placeholder={t('property.locationPlaceholder', 'Location')}
          value={formData.location}
          onChangeText={(value) => handleInputChange('location', value)}
          editable={!loading}
          textAlign={isRTL ? 'right' : 'left'}
          data-testid="input-location"
        />
      </View>

      <View style={styles.row}>
        <View style={[styles.inputGroup, styles.halfWidth]}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{t('home.hero.country')}</Text>
          <TextInput
            style={[styles.input, isRTL && styles.rtlInput]}
            placeholder={t('home.hero.country')}
            value={formData.country}
            onChangeText={(value) => handleInputChange('country', value)}
            editable={!loading}
            textAlign={isRTL ? 'right' : 'left'}
            data-testid="input-country"
          />
        </View>

        <View style={[styles.inputGroup, styles.halfWidth]}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{t('home.hero.city')}</Text>
          <TextInput
            style={[styles.input, isRTL && styles.rtlInput]}
            placeholder={t('home.hero.city')}
            value={formData.city}
            onChangeText={(value) => handleInputChange('city', value)}
            editable={!loading}
            textAlign={isRTL ? 'right' : 'left'}
            data-testid="input-city"
          />
        </View>
      </View>

      {propertyType !== 'land' && (
        <View style={styles.row}>
          <View style={[styles.inputGroup, styles.halfWidth]}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('property.bedrooms')}</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder="0"
              value={formData.bedrooms}
              onChangeText={(value) => handleInputChange('bedrooms', value)}
              keyboardType="numeric"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-bedrooms"
            />
          </View>

          <View style={[styles.inputGroup, styles.halfWidth]}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('property.bathrooms')}</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder="0"
              value={formData.bathrooms}
              onChangeText={(value) => handleInputChange('bathrooms', value)}
              keyboardType="numeric"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-bathrooms"
            />
          </View>
        </View>
      )}

      {propertyType === 'apartment' && (
        <View style={styles.inputGroup}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{t('property.floorNumber', 'Floor Number')}</Text>
          <TextInput
            style={[styles.input, isRTL && styles.rtlInput]}
            placeholder="0"
            value={formData.floorNumber}
            onChangeText={(value) => handleInputChange('floorNumber', value)}
            keyboardType="numeric"
            editable={!loading}
            textAlign={isRTL ? 'right' : 'left'}
            data-testid="input-floor"
          />
        </View>
      )}
    </>
  );

  const renderMediaStep = () => (
    <>
      <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('property.uploadImages')}</Text>
      <Text style={[styles.sectionSubtitle, isRTL && styles.rtlText]}>
        {t('property.uploadImagesHint', 'Add photos and videos of your property')}
      </Text>

      <View style={styles.mediaButtons}>
        <TouchableOpacity style={styles.addMediaButton} onPress={handleAddImage} data-testid="button-add-image">
          <Text style={styles.addMediaIcon}>📷</Text>
          <Text style={styles.addMediaText}>{t('property.addImage', 'Add Image')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.addMediaButton} onPress={handleAddVideo} data-testid="button-add-video">
          <Text style={styles.addMediaIcon}>🎥</Text>
          <Text style={styles.addMediaText}>{t('property.addVideo', 'Add Video')}</Text>
        </TouchableOpacity>
      </View>

      {mediaFiles.length > 0 && (
        <View style={styles.mediaGrid}>
          {mediaFiles.map((media, index) => (
            <View key={index} style={styles.mediaItem}>
              {media.type === 'image' ? (
                <Image source={{ uri: media.uri }} style={styles.mediaImage} />
              ) : (
                <View style={styles.videoPlaceholder}>
                  <Text style={styles.videoIcon}>🎬</Text>
                  <Text style={styles.videoText}>{t('property.video', 'Video')}</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.removeMediaButton}
                onPress={() => handleRemoveMedia(index)}
                data-testid={`button-remove-media-${index}`}
              >
                <Text style={styles.removeMediaText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.mediaCount}>
        {t('property.imagesCount', '{{count}} images', { count: mediaFiles.filter((m) => m.type === 'image').length })} | {' '}
        {t('property.videosCount', '{{count}} videos', { count: mediaFiles.filter((m) => m.type === 'video').length })}
      </Text>
    </>
  );

  const renderListingStep = () => (
    <>
      <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('property.listingType')}</Text>
      <Text style={[styles.sectionSubtitle, isRTL && styles.rtlText]}>
        {t('property.chooseListingType', 'Choose how you want your property to be featured')}
      </Text>

      {(['regular', 'vip', 'super_vip'] as ListingType[]).map((type) => (
        <TouchableOpacity
          key={type}
          style={[styles.listingOption, listingType === type && styles.listingOptionActive]}
          onPress={() => setListingType(type)}
          data-testid={`option-listing-${type}`}
        >
          <View style={styles.listingOptionHeader}>
            <View style={[styles.radioButton, listingType === type && styles.radioButtonActive]}>
              {listingType === type && <View style={styles.radioButtonInner} />}
            </View>
            <Text style={[styles.listingOptionTitle, listingType === type && styles.listingOptionTitleActive]}>
              {t(`listingTypes.${type}`)}
            </Text>
            <Text style={[styles.listingPrice, listingType === type && styles.listingPriceActive]}>
              {LISTING_PRICES[type].price === 0 ? t('common.free', 'Free') : `$${LISTING_PRICES[type].price}`}
            </Text>
          </View>
          <Text style={styles.listingDuration}>
            {t('property.duration', 'Duration')}: {LISTING_PRICES[type].duration}
          </Text>
          {type === 'vip' && (
            <Text style={styles.listingBenefit}>{t('property.vipBenefit', 'Featured on homepage, priority in search')}</Text>
          )}
          {type === 'super_vip' && (
            <Text style={styles.listingBenefit}>{t('property.superVipBenefit', 'Top position, social media promotion, dedicated support')}</Text>
          )}
        </TouchableOpacity>
      ))}
    </>
  );

  const renderPaymentStep = () => (
    <>
      <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('payment.title', 'Payment')}</Text>
      <Text style={[styles.sectionSubtitle, isRTL && styles.rtlText]}>
        {t('payment.subtitle', 'Complete payment to publish your listing')}
      </Text>

      <View style={styles.paymentSummary}>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentLabel}>{t('property.listingType')}:</Text>
          <Text style={styles.paymentValue}>{t(`listingTypes.${listingType}`)}</Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentLabel}>{t('property.duration', 'Duration')}:</Text>
          <Text style={styles.paymentValue}>{LISTING_PRICES[listingType].duration}</Text>
        </View>
        <View style={[styles.paymentRow, styles.paymentTotal]}>
          <Text style={styles.paymentTotalLabel}>{t('payment.total', 'Total')}:</Text>
          <Text style={styles.paymentTotalValue}>${LISTING_PRICES[listingType].price}</Text>
        </View>
      </View>

      <View style={styles.paymentMethods}>
        <Text style={styles.paymentMethodsTitle}>{t('payment.selectMethod', 'Select Payment Method')}</Text>
        
        <TouchableOpacity style={styles.paymentMethod} data-testid="button-pay-card">
          <Text style={styles.paymentMethodIcon}>💳</Text>
          <Text style={styles.paymentMethodText}>{t('payment.creditCard', 'Credit/Debit Card')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.paymentMethod} data-testid="button-pay-paypal">
          <Text style={styles.paymentMethodIcon}>🅿️</Text>
          <Text style={styles.paymentMethodText}>PayPal</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.payButton, loading && styles.payButtonDisabled]}
        onPress={handlePayment}
        disabled={loading}
        data-testid="button-pay"
      >
        {loading ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.payButtonText}>
            {t('payment.payNow', 'Pay Now')} - ${LISTING_PRICES[listingType].price}
          </Text>
        )}
      </TouchableOpacity>
    </>
  );

  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      {['details', 'media', 'listing', 'payment'].map((s, index) => (
        <View key={s} style={styles.stepItem}>
          <View
            style={[
              styles.stepCircle,
              (step === s || ['details', 'media', 'listing', 'payment'].indexOf(step) >= index) && styles.stepCircleActive,
            ]}
          >
            <Text style={[styles.stepNumber, (step === s || ['details', 'media', 'listing', 'payment'].indexOf(step) >= index) && styles.stepNumberActive]}>
              {index + 1}
            </Text>
          </View>
          {index < 3 && <View style={[styles.stepLine, ['details', 'media', 'listing', 'payment'].indexOf(step) > index && styles.stepLineActive]} />}
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, isRTL && styles.rtlText]}>{t('property.submit')}</Text>
        <Text style={[styles.headerSubtitle, isRTL && styles.rtlText]}>
          {t('property.type')}: {t(`propertyTypes.${propertyType}`)}
        </Text>
      </View>

      {renderStepIndicator()}

      <View style={styles.form}>
        {step === 'details' && renderDetailsStep()}
        {step === 'media' && renderMediaStep()}
        {step === 'listing' && renderListingStep()}
        {step === 'payment' && renderPaymentStep()}

        {step !== 'payment' && (
          <View style={styles.navigationButtons}>
            {step !== 'details' && (
              <TouchableOpacity style={styles.backButton} onPress={handlePreviousStep} data-testid="button-back">
                <Text style={styles.backButtonText}>{t('common.back')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.nextButton, loading && styles.nextButtonDisabled]}
              onPress={handleNextStep}
              disabled={loading}
              data-testid="button-next"
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.nextButtonText}>
                  {step === 'listing' && listingType === 'regular' ? t('common.submit') : t('common.next')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {step === 'payment' && (
          <TouchableOpacity style={styles.backButton} onPress={handlePreviousStep} data-testid="button-back-payment">
            <Text style={styles.backButtonText}>{t('common.back')}</Text>
          </TouchableOpacity>
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
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
    backgroundColor: COLORS.white,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepCircleActive: {
    backgroundColor: COLORS.primary,
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.gray,
  },
  stepNumberActive: {
    color: COLORS.white,
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: 4,
  },
  stepLineActive: {
    backgroundColor: COLORS.primary,
  },
  form: {
    padding: SPACING.lg,
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  halfWidth: {
    flex: 1,
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
  rtlInput: {
    textAlign: 'right',
  },
  rtlText: {
    textAlign: 'right',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: SPACING.lg,
  },
  mediaButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  addMediaButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  addMediaIcon: {
    fontSize: 32,
    marginBottom: SPACING.sm,
  },
  addMediaText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  mediaItem: {
    width: '31%',
    aspectRatio: 1,
    position: 'relative',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: COLORS.gray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoIcon: {
    fontSize: 24,
  },
  videoText: {
    fontSize: 12,
    color: COLORS.white,
    marginTop: 4,
  },
  removeMediaButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeMediaText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  mediaCount: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
  },
  listingOption: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  listingOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#f0f9ff',
  },
  listingOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.gray,
    marginRight: SPACING.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioButtonActive: {
    borderColor: COLORS.primary,
  },
  radioButtonInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  listingOptionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  listingOptionTitleActive: {
    color: COLORS.primary,
  },
  listingPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.gray,
  },
  listingPriceActive: {
    color: COLORS.primary,
  },
  listingDuration: {
    fontSize: 14,
    color: COLORS.gray,
    marginLeft: 28,
  },
  listingBenefit: {
    fontSize: 12,
    color: COLORS.secondary,
    marginLeft: 28,
    marginTop: 4,
  },
  paymentSummary: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  paymentLabel: {
    fontSize: 14,
    color: COLORS.gray,
  },
  paymentValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  paymentTotal: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.md,
    marginTop: SPACING.sm,
  },
  paymentTotalLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  paymentTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  paymentMethods: {
    marginBottom: SPACING.lg,
  },
  paymentMethodsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  paymentMethod: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  paymentMethodIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  paymentMethodText: {
    fontSize: 16,
    color: COLORS.text,
  },
  payButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center',
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  navigationButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  backButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  nextButton: {
    flex: 2,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center',
  },
  nextButtonDisabled: {
    opacity: 0.6,
  },
  nextButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: SPACING.xl,
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.md,
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.lg,
    alignItems: 'center',
  },
  loginButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default PropertyFormScreen;

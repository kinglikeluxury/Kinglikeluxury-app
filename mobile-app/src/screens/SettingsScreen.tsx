import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@contexts/LanguageContext';
import { COLORS, FONTS, SPACING } from '@lib/theme';
import { LanguageCode } from '@lib/i18n';

const SettingsScreen = () => {
  const { t } = useTranslation();
  const { currentLanguage, changeLanguage, languages, isRTL } = useLanguage();

  const handleLanguageChange = async (lang: LanguageCode) => {
    await changeLanguage(lang);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>
          {t('settings.language')}
        </Text>
        <Text style={[styles.sectionSubtitle, isRTL && styles.rtlText]}>
          {t('common.selectLanguage')}
        </Text>

        <View style={styles.languageGrid}>
          {(Object.keys(languages) as LanguageCode[]).map((langCode) => {
            const lang = languages[langCode];
            const isSelected = currentLanguage === langCode;

            return (
              <TouchableOpacity
                key={langCode}
                style={[
                  styles.languageButton,
                  isSelected && styles.languageButtonSelected,
                ]}
                onPress={() => handleLanguageChange(langCode)}
                data-testid={`lang-button-${langCode}`}
              >
                <Text style={styles.languageFlag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.languageName,
                    isSelected && styles.languageNameSelected,
                  ]}
                >
                  {lang.name}
                </Text>
                {isSelected && (
                  <View style={styles.checkmark}>
                    <Text style={styles.checkmarkText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>
          {t('settings.about')}
        </Text>
        <View style={styles.aboutCard}>
          <Text style={styles.appName}>{t('app.name')}</Text>
          <Text style={styles.appDescription}>{t('app.description')}</Text>
          <Text style={styles.version}>{t('settings.version')}: 1.0.0</Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  section: {
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.large,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  sectionSubtitle: {
    fontSize: FONTS.sizes.small,
    color: COLORS.textLight,
    marginBottom: SPACING.lg,
  },
  rtlText: {
    textAlign: 'right',
  },
  languageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    minWidth: '45%',
    marginBottom: SPACING.sm,
  },
  languageButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}10`,
  },
  languageFlag: {
    fontSize: 24,
    marginRight: SPACING.sm,
  },
  languageName: {
    fontSize: FONTS.sizes.medium,
    color: COLORS.text,
    flex: 1,
  },
  languageNameSelected: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 14,
  },
  aboutCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
  },
  appName: {
    fontSize: FONTS.sizes.xlarge,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  appDescription: {
    fontSize: FONTS.sizes.medium,
    color: COLORS.textLight,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  version: {
    fontSize: FONTS.sizes.small,
    color: COLORS.textLight,
  },
});

export default SettingsScreen;

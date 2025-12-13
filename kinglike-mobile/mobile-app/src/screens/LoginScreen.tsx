import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, FONTS, SPACING } from '../lib/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;

type LoginMethod = 'username' | 'phone' | 'email';

const LoginScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { login, loginWithFacebook, loginWithPhone } = useAuth();
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('username');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (loginMethod === 'username' && (!username || !password)) {
      Alert.alert(t('common.error'), t('auth.required'));
      return;
    }
    if (loginMethod === 'phone' && (!phoneNumber || !password)) {
      Alert.alert(t('common.error'), t('auth.required'));
      return;
    }
    if (loginMethod === 'email' && (!email || !password)) {
      Alert.alert(t('common.error'), t('auth.required'));
      return;
    }

    try {
      setLoading(true);
      if (loginMethod === 'phone') {
        await loginWithPhone(phoneNumber, password);
      } else {
        const identifier = loginMethod === 'email' ? email : username;
        await login(identifier, password);
      }
      navigation.navigate('Home');
    } catch (error: any) {
      Alert.alert(t('auth.loginError'), error.message || t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  const handleFacebookLogin = async () => {
    try {
      setLoading(true);
      await loginWithFacebook();
      navigation.navigate('Home');
    } catch (error: any) {
      Alert.alert(t('auth.loginError'), error.message || t('auth.facebookLoginError'));
    } finally {
      setLoading(false);
    }
  };

  const handleWhatsAppLogin = () => {
    const whatsappNumber = '+995599000000';
    const message = encodeURIComponent(t('auth.whatsappLoginMessage', 'Hello, I want to login to Kinglike Luxury app'));
    const whatsappUrl = `whatsapp://send?phone=${whatsappNumber}&text=${message}`;
    
    Linking.canOpenURL(whatsappUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(whatsappUrl);
        } else {
          Alert.alert(t('common.error'), t('auth.whatsappNotInstalled', 'WhatsApp is not installed'));
        }
      })
      .catch(() => {
        Alert.alert(t('common.error'), t('auth.whatsappError', 'Could not open WhatsApp'));
      });
  };

  const renderLoginMethodTabs = () => (
    <View style={[styles.tabsContainer, isRTL && styles.rtlRow]}>
      <TouchableOpacity
        style={[styles.tab, loginMethod === 'username' && styles.activeTab]}
        onPress={() => setLoginMethod('username')}
        data-testid="tab-username"
      >
        <Text style={[styles.tabText, loginMethod === 'username' && styles.activeTabText]}>
          {t('auth.username')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, loginMethod === 'email' && styles.activeTab]}
        onPress={() => setLoginMethod('email')}
        data-testid="tab-email"
      >
        <Text style={[styles.tabText, loginMethod === 'email' && styles.activeTabText]}>
          {t('auth.email')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, loginMethod === 'phone' && styles.activeTab]}
        onPress={() => setLoginMethod('phone')}
        data-testid="tab-phone"
      >
        <Text style={[styles.tabText, loginMethod === 'phone' && styles.activeTabText]}>
          {t('auth.phone')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderLoginInput = () => {
    switch (loginMethod) {
      case 'phone':
        return (
          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.phoneNumber')}</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder="+995 XXX XXX XXX"
              placeholderTextColor={COLORS.gray}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              autoCapitalize="none"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-phone"
            />
          </View>
        );
      case 'email':
        return (
          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.email')}</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder={t('auth.email')}
              placeholderTextColor={COLORS.gray}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-email"
            />
          </View>
        );
      default:
        return (
          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.username')}</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder={t('auth.username')}
              placeholderTextColor={COLORS.gray}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-username"
            />
          </View>
        );
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{t('auth.welcomeBack')}</Text>
          <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t('auth.signInToContinue')}</Text>
        </View>

        {renderLoginMethodTabs()}

        <View style={styles.form}>
          {renderLoginInput()}

          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.password')}</Text>
            <View style={[styles.passwordContainer, isRTL && styles.rtlRow]}>
              <TextInput
                style={[styles.passwordInput, isRTL && styles.rtlInput]}
                placeholder={t('auth.password')}
                placeholderTextColor={COLORS.gray}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!loading}
                textAlign={isRTL ? 'right' : 'left'}
                data-testid="input-password"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                <Text style={styles.eyeText}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            data-testid="button-login"
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.loginButtonText}>{t('auth.login')}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t('auth.orContinueWith', 'or continue with')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialButtons}>
            <TouchableOpacity
              style={[styles.socialButton, styles.facebookButton]}
              onPress={handleFacebookLogin}
              disabled={loading}
              data-testid="button-facebook-login"
            >
              <Text style={styles.socialButtonIcon}>📘</Text>
              <Text style={styles.socialButtonText}>{t('auth.facebookLogin', 'Facebook')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.socialButton, styles.whatsappButton]}
              onPress={handleWhatsAppLogin}
              disabled={loading}
              data-testid="button-whatsapp-login"
            >
              <Text style={styles.socialButtonIcon}>💬</Text>
              <Text style={styles.socialButtonText}>{t('auth.whatsappLogin', 'WhatsApp')}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.registerContainer, isRTL && styles.rtlRow]}>
            <Text style={styles.registerText}>{t('auth.noAccount')} </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')} data-testid="link-register">
              <Text style={styles.registerLink}>{t('auth.register')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  header: {
    marginBottom: SPACING.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.gray,
  },
  tabsContainer: {
    flexDirection: 'row',
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: 6,
  },
  activeTab: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    fontSize: 14,
    color: COLORS.gray,
    fontWeight: '600',
  },
  activeTabText: {
    color: COLORS.white,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
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
  rtlInput: {
    textAlign: 'right',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  passwordInput: {
    flex: 1,
    padding: SPACING.md,
    fontSize: 16,
    color: COLORS.text,
  },
  eyeButton: {
    padding: SPACING.md,
  },
  eyeText: {
    fontSize: 20,
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    marginHorizontal: SPACING.md,
    color: COLORS.gray,
    fontSize: 14,
  },
  socialButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    borderRadius: 8,
    gap: SPACING.sm,
  },
  facebookButton: {
    backgroundColor: '#1877F2',
  },
  whatsappButton: {
    backgroundColor: '#25D366',
  },
  socialButtonIcon: {
    fontSize: 20,
  },
  socialButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.lg,
  },
  registerText: {
    color: COLORS.gray,
    fontSize: 14,
  },
  registerLink: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rtlText: {
    textAlign: 'right',
  },
  rtlRow: {
    flexDirection: 'row-reverse',
  },
});

export default LoginScreen;

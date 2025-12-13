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
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, FONTS, SPACING } from '../lib/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Register'>;

const RegisterScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { register, loginWithFacebook } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleRegister = async () => {
    if (!username || !email || !password || !confirmPassword) {
      Alert.alert(t('common.error'), t('auth.required'));
      return;
    }

    if (username.length < 3) {
      Alert.alert(t('common.error'), t('auth.usernameMinLength', 'Username must be at least 3 characters'));
      return;
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      Alert.alert(t('common.error'), t('auth.invalidEmail'));
      return;
    }

    if (password.length < 6) {
      Alert.alert(t('common.error'), t('auth.passwordMinLength', 'Password must be at least 6 characters'));
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(t('common.error'), t('auth.passwordMismatch'));
      return;
    }

    try {
      setLoading(true);
      await register({
        username,
        email,
        password,
        phoneNumber: phoneNumber || undefined,
        whatsappNumber: whatsappNumber || undefined,
      });
      Alert.alert(t('common.success'), t('auth.registerSuccess'), [
        {
          text: 'OK',
          onPress: () => navigation.navigate('Home'),
        },
      ]);
    } catch (error: any) {
      Alert.alert(t('auth.registerError'), error.message || t('auth.registerError'));
    } finally {
      setLoading(false);
    }
  };

  const handleFacebookRegister = async () => {
    try {
      setLoading(true);
      await loginWithFacebook();
      navigation.navigate('Home');
    } catch (error: any) {
      Alert.alert(t('auth.registerError'), error.message || t('auth.facebookLoginError'));
    } finally {
      setLoading(false);
    }
  };

  const handleWhatsAppRegister = () => {
    const whatsappSupportNumber = '+995599000000';
    const message = encodeURIComponent(t('auth.whatsappRegisterMessage', 'Hello, I want to register for Kinglike Luxury app'));
    const whatsappUrl = `whatsapp://send?phone=${whatsappSupportNumber}&text=${message}`;
    
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{t('auth.createAccount')}</Text>
          <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t('auth.signUpToGetStarted', 'Sign up to get started')}</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.username')} *</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder={t('auth.chooseUsername', 'Choose a username')}
              placeholderTextColor={COLORS.gray}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-username"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.email')} *</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder={t('auth.enterEmail', 'Enter your email')}
              placeholderTextColor={COLORS.gray}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-email"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.phoneNumber')} ({t('common.optional', 'Optional')})</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder="+995 XXX XXX XXX"
              placeholderTextColor={COLORS.gray}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-phone"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.whatsappNumber')} ({t('common.optional', 'Optional')})</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              placeholder="+995 XXX XXX XXX"
              placeholderTextColor={COLORS.gray}
              value={whatsappNumber}
              onChangeText={setWhatsappNumber}
              keyboardType="phone-pad"
              editable={!loading}
              textAlign={isRTL ? 'right' : 'left'}
              data-testid="input-whatsapp"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.password')} *</Text>
            <View style={[styles.passwordContainer, isRTL && styles.rtlRow]}>
              <TextInput
                style={[styles.passwordInput, isRTL && styles.rtlInput]}
                placeholder={t('auth.createPassword', 'Create a password')}
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

          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('auth.confirmPassword')} *</Text>
            <View style={[styles.passwordContainer, isRTL && styles.rtlRow]}>
              <TextInput
                style={[styles.passwordInput, isRTL && styles.rtlInput]}
                placeholder={t('auth.confirmYourPassword', 'Confirm your password')}
                placeholderTextColor={COLORS.gray}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                editable={!loading}
                textAlign={isRTL ? 'right' : 'left'}
                data-testid="input-confirm-password"
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeButton}
              >
                <Text style={styles.eyeText}>{showConfirmPassword ? '👁️' : '👁️‍🗨️'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.registerButton, loading && styles.registerButtonDisabled]}
            onPress={handleRegister}
            disabled={loading}
            data-testid="button-register"
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.registerButtonText}>{t('auth.signUp', 'Sign Up')}</Text>
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
              onPress={handleFacebookRegister}
              disabled={loading}
              data-testid="button-facebook-register"
            >
              <Text style={styles.socialButtonIcon}>📘</Text>
              <Text style={styles.socialButtonText}>{t('auth.facebookLogin', 'Facebook')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.socialButton, styles.whatsappButton]}
              onPress={handleWhatsAppRegister}
              disabled={loading}
              data-testid="button-whatsapp-register"
            >
              <Text style={styles.socialButtonIcon}>💬</Text>
              <Text style={styles.socialButtonText}>{t('auth.whatsappLogin', 'WhatsApp')}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.loginContainer, isRTL && styles.rtlRow]}>
            <Text style={styles.loginText}>{t('auth.hasAccount')} </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')} data-testid="link-login">
              <Text style={styles.loginLink}>{t('auth.login')}</Text>
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
  registerButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  registerButtonDisabled: {
    opacity: 0.6,
  },
  registerButtonText: {
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
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.lg,
  },
  loginText: {
    color: COLORS.gray,
    fontSize: 14,
  },
  loginLink: {
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

export default RegisterScreen;

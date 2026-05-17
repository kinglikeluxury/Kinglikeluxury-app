import { useState, useRef } from 'react';
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
import { API_URL } from '../config/api.config';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Register'>;

type VerifyStep = 'idle' | 'sending' | 'awaiting_code' | 'verifying' | 'verified';

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

  // SMS verification state
  const [verifyStep, setVerifyStep] = useState<VerifyStep>('idle');
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyMethod, setVerifyMethod] = useState<'sms' | 'whatsapp'>('sms');
  const codeInputRef = useRef<TextInput>(null);

  const isPhoneVerified = verifyStep === 'verified';

  const handleSendCode = async () => {
    const phone = phoneNumber.trim();
    if (!phone) {
      Alert.alert(t('common.error'), t('auth.phoneRequired', 'Phone number is required'));
      return;
    }
    if (!/^\+\d{7,15}$/.test(phone)) {
      Alert.alert(
        t('common.error'),
        t('auth.invalidPhone', 'Enter a valid phone number starting with + (e.g. +995599123456)')
      );
      return;
    }

    try {
      setVerifyStep('sending');
      const res = await fetch(`${API_URL}/auth/send-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send code');

      setVerifyMethod(data.method === 'whatsapp' ? 'whatsapp' : 'sms');
      setVerifyStep('awaiting_code');
      setTimeout(() => codeInputRef.current?.focus(), 300);

      const channel = data.method === 'whatsapp' ? 'WhatsApp' : 'SMS';
      Alert.alert(
        t('auth.codeSent', 'Code Sent'),
        t('auth.codeSentTo', `Verification code sent via ${channel} to ${phone}`, { channel, phone })
      );
    } catch (err: any) {
      setVerifyStep('idle');
      Alert.alert(t('common.error'), err.message || t('auth.sendCodeError', 'Could not send code'));
    }
  };

  const handleVerifyCode = async () => {
    if (verificationCode.length !== 6) {
      Alert.alert(t('common.error'), t('auth.enter6DigitCode', 'Enter the 6-digit code'));
      return;
    }
    try {
      setVerifyStep('verifying');
      const res = await fetch(`${API_URL}/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim(), code: verificationCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Invalid code');

      setVerifyStep('verified');
    } catch (err: any) {
      setVerifyStep('awaiting_code');
      setVerificationCode('');
      Alert.alert(
        t('auth.verificationFailed', 'Verification Failed'),
        err.message || t('auth.invalidCode', 'Invalid or expired code. Please try again.')
      );
    }
  };

  const handleResendCode = () => {
    setVerificationCode('');
    setVerifyStep('idle');
    setTimeout(handleSendCode, 100);
  };

  const handleRegister = async () => {
    if (!username || !email || !phoneNumber || !password || !confirmPassword) {
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
    if (!isPhoneVerified) {
      Alert.alert(t('common.error'), t('auth.verifyPhoneFirst', 'Please verify your phone number first'));
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
        phoneNumber: phoneNumber.trim(),
        whatsappNumber: whatsappNumber || undefined,
      });
      Alert.alert(t('common.success'), t('auth.registerSuccess'), [
        { text: 'OK', onPress: () => navigation.navigate('Home') },
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

  const isSendingOrVerifying = verifyStep === 'sending' || verifyStep === 'verifying';

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
          {/* Username */}
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

          {/* Email */}
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

          {/* Phone number + verification */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>
              {t('auth.phoneNumber')} *{' '}
              {isPhoneVerified && (
                <Text style={styles.verifiedBadge}>✓ {t('auth.verified', 'Verified')}</Text>
              )}
            </Text>

            <View style={[styles.phoneRow, isRTL && styles.rtlRow]}>
              <TextInput
                style={[
                  styles.phoneInput,
                  isRTL && styles.rtlInput,
                  isPhoneVerified && styles.inputVerified,
                ]}
                placeholder="+995 XXX XXX XXX"
                placeholderTextColor={COLORS.gray}
                value={phoneNumber}
                onChangeText={(v) => {
                  setPhoneNumber(v);
                  if (verifyStep !== 'idle') {
                    setVerifyStep('idle');
                    setVerificationCode('');
                  }
                }}
                keyboardType="phone-pad"
                editable={!loading && verifyStep !== 'verified'}
                textAlign={isRTL ? 'right' : 'left'}
                data-testid="input-phone"
              />

              {verifyStep !== 'verified' && (
                <TouchableOpacity
                  style={[styles.sendCodeBtn, isSendingOrVerifying && styles.btnDisabled]}
                  onPress={handleSendCode}
                  disabled={isSendingOrVerifying || loading}
                  data-testid="button-send-code"
                >
                  {verifyStep === 'sending' ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.sendCodeText}>
                      {verifyStep === 'awaiting_code'
                        ? t('auth.resend', 'Resend')
                        : t('auth.sendCode', 'Send Code')}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* Code entry box — shown after code is sent */}
            {(verifyStep === 'awaiting_code' || verifyStep === 'verifying') && (
              <View style={styles.codeSection}>
                <Text style={[styles.codeHint, isRTL && styles.rtlText]}>
                  {verifyMethod === 'whatsapp'
                    ? t('auth.codeHintWhatsApp', 'Enter the code sent via WhatsApp')
                    : t('auth.codeHintSMS', 'Enter the 6-digit code sent via SMS')}
                </Text>

                <View style={[styles.codeRow, isRTL && styles.rtlRow]}>
                  <TextInput
                    ref={codeInputRef}
                    style={[styles.codeInput, isRTL && styles.rtlInput]}
                    placeholder="000000"
                    placeholderTextColor={COLORS.gray}
                    value={verificationCode}
                    onChangeText={(v) => setVerificationCode(v.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={verifyStep === 'awaiting_code'}
                    textAlign="center"
                    data-testid="input-verification-code"
                  />

                  <TouchableOpacity
                    style={[
                      styles.verifyBtn,
                      (verifyStep === 'verifying' || verificationCode.length !== 6) && styles.btnDisabled,
                    ]}
                    onPress={handleVerifyCode}
                    disabled={verifyStep === 'verifying' || verificationCode.length !== 6}
                    data-testid="button-verify-code"
                  >
                    {verifyStep === 'verifying' ? (
                      <ActivityIndicator size="small" color={COLORS.white} />
                    ) : (
                      <Text style={styles.verifyBtnText}>{t('auth.verify', 'Verify')}</Text>
                    )}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity onPress={handleResendCode} style={styles.resendLink}>
                  <Text style={styles.resendLinkText}>
                    {t('auth.didntReceiveCode', "Didn't receive the code? Resend")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* WhatsApp number (optional) */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>
              {t('auth.whatsappNumber')} ({t('common.optional', 'Optional')})
            </Text>
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

          {/* Password */}
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
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                <Text style={styles.eyeText}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Confirm Password */}
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
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                <Text style={styles.eyeText}>{showConfirmPassword ? '👁️' : '👁️‍🗨️'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Phone not yet verified warning */}
          {!isPhoneVerified && phoneNumber.length > 4 && verifyStep === 'idle' && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                📱 {t('auth.verifyPhoneFirst', 'Please verify your phone number before registering')}
              </Text>
            </View>
          )}

          {/* Register button */}
          <TouchableOpacity
            style={[
              styles.registerButton,
              (!isPhoneVerified || loading) && styles.registerButtonDisabled,
            ]}
            onPress={handleRegister}
            disabled={!isPhoneVerified || loading}
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
  verifiedBadge: {
    color: '#16a34a',
    fontWeight: '700',
    fontSize: 13,
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
  inputVerified: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },
  rtlInput: {
    textAlign: 'right',
  },
  // Phone row (input + send code button side by side)
  phoneRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  phoneInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: SPACING.md,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
  },
  sendCodeBtn: {
    backgroundColor: COLORS.secondary,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCodeText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
  // Code input section
  codeSection: {
    marginTop: SPACING.md,
    backgroundColor: '#f0f9ff',
    borderRadius: 10,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  codeHint: {
    fontSize: 13,
    color: COLORS.secondary,
    marginBottom: SPACING.sm,
    fontWeight: '500',
  },
  codeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  codeInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: SPACING.md,
    fontSize: 22,
    fontWeight: '700',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    color: COLORS.text,
    letterSpacing: 6,
  },
  verifyBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  verifyBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  resendLink: {
    marginTop: SPACING.sm,
    alignItems: 'center',
  },
  resendLinkText: {
    color: COLORS.secondary,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  // Warning
  warningBox: {
    backgroundColor: '#fff7ed',
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  warningText: {
    color: '#c2410c',
    fontSize: 13,
    fontWeight: '500',
  },
  // Password fields
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
  // Register button
  registerButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  registerButtonDisabled: {
    opacity: 0.45,
  },
  registerButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Divider
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
  // Social buttons
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
  // Login link
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

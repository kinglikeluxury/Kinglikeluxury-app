import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, FONTS, SPACING } from '../lib/theme';
import { verifyPhoneCode, sendVerificationCode } from '../lib/api';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'PhoneVerification'>;
type VerificationRouteProp = RouteProp<RootStackParamList, 'PhoneVerification'>;

const CODE_LENGTH = 6;

const PhoneVerificationScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<VerificationRouteProp>();
  const { t } = useTranslation();

  const { phoneNumber, onVerified } = route.params;

  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);

  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (countdown <= 0) {
      setCanResend(true);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleInput = (text: string, index: number) => {
    const digit = text.replace(/\D/g, '').slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    if (digit && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    if (newCode.every((d) => d !== '') && newCode.join('').length === CODE_LENGTH) {
      handleVerify(newCode.join(''));
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (fullCode?: string) => {
    const codeStr = fullCode || code.join('');
    if (codeStr.length < CODE_LENGTH) {
      Alert.alert(t('common.error', 'Error'), t('auth.enterFullCode', 'Please enter the full 6-digit code'));
      return;
    }
    setLoading(true);
    try {
      await verifyPhoneCode(phoneNumber, codeStr);
      Alert.alert(
        t('common.success', 'Success'),
        t('auth.phoneVerified', 'Phone number verified successfully!'),
        [{ text: 'OK', onPress: () => { onVerified?.(); navigation.navigate('Home'); } }]
      );
    } catch (error: any) {
      Alert.alert(
        t('common.error', 'Error'),
        t('auth.invalidCode', 'Invalid or expired code. Please try again.')
      );
      setCode(Array(CODE_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setResending(true);
    try {
      const result = await sendVerificationCode(phoneNumber);
      setCountdown(60);
      setCanResend(false);
      setCode(Array(CODE_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
      Alert.alert(
        t('common.success', 'Success'),
        result.method === 'whatsapp'
          ? t('auth.codeSentWhatsapp', 'Code sent via WhatsApp')
          : t('auth.codeSentSms', 'Code sent via SMS')
      );
    } catch (error: any) {
      Alert.alert(t('common.error', 'Error'), error?.response?.data?.message || t('auth.sendCodeError', 'Failed to send code'));
    } finally {
      setResending(false);
    }
  };

  const maskedPhone = phoneNumber.length > 6
    ? phoneNumber.slice(0, 4) + '****' + phoneNumber.slice(-3)
    : phoneNumber;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconWrapper}>
          <Text style={styles.icon}>📱</Text>
        </View>

        <Text style={styles.title}>{t('auth.verifyPhone', 'Verify Your Phone')}</Text>
        <Text style={styles.subtitle}>
          {t('auth.codeSentTo', 'We sent a 6-digit code to')}{'\n'}
          <Text style={styles.phone}>{maskedPhone}</Text>
        </Text>

        {/* OTP Inputs */}
        <View style={styles.codeRow}>
          {Array(CODE_LENGTH).fill(null).map((_, i) => (
            <TextInput
              key={i}
              ref={(r) => { inputRefs.current[i] = r; }}
              style={[styles.codeBox, code[i] ? styles.codeBoxFilled : null]}
              value={code[i]}
              onChangeText={(t) => handleInput(t, i)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              editable={!loading}
              textAlign="center"
            />
          ))}
        </View>

        {/* Verify Button */}
        <TouchableOpacity
          style={[styles.verifyButton, (loading || code.some((d) => !d)) && styles.buttonDisabled]}
          onPress={() => handleVerify()}
          disabled={loading || code.some((d) => !d)}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.verifyButtonText}>{t('auth.verifyCode', 'Verify Code')}</Text>
          )}
        </TouchableOpacity>

        {/* Resend */}
        <View style={styles.resendRow}>
          {canResend ? (
            <TouchableOpacity onPress={handleResend} disabled={resending}>
              {resending ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Text style={styles.resendLink}>{t('auth.resendCode', 'Resend Code')}</Text>
              )}
            </TouchableOpacity>
          ) : (
            <Text style={styles.countdown}>
              {t('auth.resendIn', 'Resend in')} {countdown}s
            </Text>
          )}
        </View>

        {/* Skip */}
        <TouchableOpacity onPress={() => navigation.navigate('Home')} style={styles.skipRow}>
          <Text style={styles.skipText}>{t('auth.skipVerification', 'Skip for now')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  iconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e8fafa',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  icon: {
    fontSize: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#005476',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: SPACING.xl,
    lineHeight: 22,
  },
  phone: {
    fontWeight: 'bold',
    color: '#3bcac4',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: SPACING.xl,
  },
  codeBox: {
    width: 46,
    height: 56,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    color: '#005476',
    textAlign: 'center',
  },
  codeBoxFilled: {
    borderColor: '#3bcac4',
    backgroundColor: '#e8fafa',
  },
  verifyButton: {
    width: '100%',
    backgroundColor: '#3bcac4',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  verifyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resendRow: {
    marginBottom: SPACING.md,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resendLink: {
    color: '#005476',
    fontSize: 15,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  countdown: {
    color: '#9ca3af',
    fontSize: 14,
  },
  skipRow: {
    marginTop: SPACING.sm,
  },
  skipText: {
    color: '#9ca3af',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});

export default PhoneVerificationScreen;

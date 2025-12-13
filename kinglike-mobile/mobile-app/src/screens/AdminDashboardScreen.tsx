import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getProperties, getAdminStats } from '../lib/api';
import { COLORS, SPACING } from '../lib/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AdminDashboard'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  byType: {
    apartment: number;
    villa: number;
    land: number;
    commercial: number;
  };
  byListing: {
    regular: number;
    vip: number;
    super_vip: number;
  };
  recentActivity: {
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
}

const AdminDashboardScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    byType: { apartment: 0, villa: 0, land: 0, commercial: 0 },
    byListing: { regular: 0, vip: 0, super_vip: 0 },
    recentActivity: { today: 0, thisWeek: 0, thisMonth: 0 },
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await getProperties({ status: 'all' });
      
      const byType = { apartment: 0, villa: 0, land: 0, commercial: 0 };
      const byListing = { regular: 0, vip: 0, super_vip: 0 };
      
      data.forEach((p: any) => {
        if (p.propertyType in byType) {
          byType[p.propertyType as keyof typeof byType]++;
        }
        if (p.listingType in byListing) {
          byListing[p.listingType as keyof typeof byListing]++;
        }
      });

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const recentActivity = {
        today: data.filter((p: any) => new Date(p.createdAt) >= todayStart).length,
        thisWeek: data.filter((p: any) => new Date(p.createdAt) >= weekStart).length,
        thisMonth: data.filter((p: any) => new Date(p.createdAt) >= monthStart).length,
      };

      setStats({
        total: data.length,
        pending: data.filter((p: any) => p.status === 'pending').length,
        approved: data.filter((p: any) => p.status === 'approved').length,
        rejected: data.filter((p: any) => p.status === 'rejected').length,
        byType,
        byListing,
        recentActivity,
      });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!user?.isAdmin) {
    return (
      <View style={styles.container}>
        <View style={styles.accessDenied}>
          <Text style={styles.accessDeniedIcon}>🔒</Text>
          <Text style={[styles.accessDeniedText, isRTL && styles.rtlText]}>{t('errors.unauthorized')}</Text>
          <Text style={[styles.accessDeniedSubtext, isRTL && styles.rtlText]}>
            {t('errors.unauthorizedMessage')}
          </Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  const renderBarChart = (data: { label: string; value: number; color: string }[], maxValue: number) => {
    return (
      <View style={styles.barChart}>
        {data.map((item, index) => (
          <View key={index} style={styles.barItem}>
            <View style={styles.barContainer}>
              <View
                style={[
                  styles.bar,
                  {
                    height: maxValue > 0 ? (item.value / maxValue) * 100 : 0,
                    backgroundColor: item.color,
                  },
                ]}
              />
            </View>
            <Text style={styles.barValue}>{item.value}</Text>
            <Text style={styles.barLabel} numberOfLines={1}>{item.label}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderPieChart = (data: { label: string; value: number; color: string }[]) => {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    
    return (
      <View style={styles.pieChartContainer}>
        <View style={styles.pieChart}>
          {data.map((item, index) => {
            const percentage = total > 0 ? (item.value / total) * 100 : 0;
            const angle = (percentage / 100) * 360;
            return (
              <View key={index} style={styles.pieSliceContainer}>
                <View style={[styles.pieSliceIndicator, { backgroundColor: item.color }]} />
                <Text style={styles.pieSliceLabel}>{item.label}: {item.value} ({percentage.toFixed(0)}%)</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.pieTotalContainer}>
          <Text style={styles.pieTotalValue}>{total}</Text>
          <Text style={styles.pieTotalLabel}>{t('admin.totalProperties', 'Total')}</Text>
        </View>
      </View>
    );
  };

  const statusData = [
    { label: t('propertyStatus.pending'), value: stats.pending, color: '#FFA500' },
    { label: t('propertyStatus.approved'), value: stats.approved, color: '#4CAF50' },
    { label: t('propertyStatus.rejected'), value: stats.rejected, color: '#F44336' },
  ];

  const typeData = [
    { label: t('propertyTypes.apartment'), value: stats.byType.apartment, color: COLORS.primary },
    { label: t('propertyTypes.villa'), value: stats.byType.villa, color: COLORS.secondary },
    { label: t('propertyTypes.land'), value: stats.byType.land, color: '#9C27B0' },
    { label: t('propertyTypes.commercial'), value: stats.byType.commercial, color: '#FF5722' },
  ];

  const listingData = [
    { label: t('listingTypes.regular'), value: stats.byListing.regular, color: '#607D8B' },
    { label: t('listingTypes.vip'), value: stats.byListing.vip, color: '#FFC107' },
    { label: t('listingTypes.super_vip'), value: stats.byListing.super_vip, color: '#E91E63' },
  ];

  const maxTypeValue = Math.max(...Object.values(stats.byType), 1);
  const maxListingValue = Math.max(...Object.values(stats.byListing), 1);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, isRTL && styles.rtlText]}>{t('admin.dashboard')}</Text>
        <Text style={[styles.headerSubtitle, isRTL && styles.rtlText]}>
          {t('admin.manageProperties', 'Manage properties and users')}
        </Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, styles.primaryCard]}>
          <Text style={styles.statIcon}>🏠</Text>
          <Text style={styles.statValue}>{stats.total}</Text>
          <Text style={styles.statLabel}>{t('admin.totalProperties', 'Total Properties')}</Text>
        </View>

        <View style={[styles.statCard, styles.warningCard]}>
          <Text style={styles.statIcon}>⏳</Text>
          <Text style={styles.statValue}>{stats.pending}</Text>
          <Text style={styles.statLabel}>{t('propertyStatus.pending')}</Text>
        </View>

        <View style={[styles.statCard, styles.successCard]}>
          <Text style={styles.statIcon}>✅</Text>
          <Text style={styles.statValue}>{stats.approved}</Text>
          <Text style={styles.statLabel}>{t('propertyStatus.approved')}</Text>
        </View>

        <View style={[styles.statCard, styles.dangerCard]}>
          <Text style={styles.statIcon}>❌</Text>
          <Text style={styles.statValue}>{stats.rejected}</Text>
          <Text style={styles.statLabel}>{t('propertyStatus.rejected')}</Text>
        </View>
      </View>

      <View style={styles.chartSection}>
        <Text style={[styles.chartTitle, isRTL && styles.rtlText]}>
          {t('admin.propertyStatus', 'Property Status Distribution')}
        </Text>
        {renderPieChart(statusData)}
      </View>

      <View style={styles.chartSection}>
        <Text style={[styles.chartTitle, isRTL && styles.rtlText]}>
          {t('admin.propertyTypes', 'Properties by Type')}
        </Text>
        {renderBarChart(typeData, maxTypeValue)}
      </View>

      <View style={styles.chartSection}>
        <Text style={[styles.chartTitle, isRTL && styles.rtlText]}>
          {t('admin.listingTypes', 'Listings by Type')}
        </Text>
        {renderBarChart(listingData, maxListingValue)}
      </View>

      <View style={styles.activitySection}>
        <Text style={[styles.chartTitle, isRTL && styles.rtlText]}>
          {t('admin.recentActivity', 'Recent Activity')}
        </Text>
        <View style={styles.activityCards}>
          <View style={styles.activityCard}>
            <Text style={styles.activityValue}>{stats.recentActivity.today}</Text>
            <Text style={styles.activityLabel}>{t('admin.today', 'Today')}</Text>
          </View>
          <View style={styles.activityCard}>
            <Text style={styles.activityValue}>{stats.recentActivity.thisWeek}</Text>
            <Text style={styles.activityLabel}>{t('admin.thisWeek', 'This Week')}</Text>
          </View>
          <View style={styles.activityCard}>
            <Text style={styles.activityValue}>{stats.recentActivity.thisMonth}</Text>
            <Text style={styles.activityLabel}>{t('admin.thisMonth', 'This Month')}</Text>
          </View>
        </View>
      </View>

      <View style={styles.actionsContainer}>
        <Text style={[styles.actionsTitle, isRTL && styles.rtlText]}>
          {t('admin.quickActions', 'Quick Actions')}
        </Text>
        
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Approvals')}
          data-testid="button-approvals"
        >
          <View style={[styles.actionButtonContent, isRTL && styles.rtlRow]}>
            <Text style={styles.actionButtonIcon}>✓</Text>
            <Text style={styles.actionButtonText}>{t('admin.approvals')}</Text>
            {stats.pending > 0 && (
              <View style={styles.actionButtonBadge}>
                <Text style={styles.actionButtonBadgeText}>{stats.pending}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('AddProject')}
          data-testid="button-add-project"
        >
          <View style={[styles.actionButtonContent, isRTL && styles.rtlRow]}>
            <Text style={styles.actionButtonIcon}>+</Text>
            <Text style={styles.actionButtonText}>{t('admin.createProject')}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Properties')}
          data-testid="button-all-properties"
        >
          <View style={[styles.actionButtonContent, isRTL && styles.rtlRow]}>
            <Text style={styles.actionButtonIcon}>🏠</Text>
            <Text style={styles.actionButtonText}>{t('admin.allProperties', 'All Properties')}</Text>
          </View>
        </TouchableOpacity>
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
  loadingText: {
    marginTop: SPACING.md,
    fontSize: 16,
    color: COLORS.gray,
  },
  header: {
    backgroundColor: COLORS.primary,
    padding: SPACING.lg,
    paddingTop: SPACING.xl,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: SPACING.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: SPACING.md,
    gap: SPACING.md,
    marginTop: -SPACING.xl,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: SPACING.lg,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  primaryCard: {
    borderTopWidth: 4,
    borderTopColor: COLORS.primary,
  },
  warningCard: {
    borderTopWidth: 4,
    borderTopColor: '#FFA500',
  },
  successCard: {
    borderTopWidth: 4,
    borderTopColor: '#4CAF50',
  },
  dangerCard: {
    borderTopWidth: 4,
    borderTopColor: '#F44336',
  },
  statIcon: {
    fontSize: 28,
    marginBottom: SPACING.xs,
  },
  statValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  chartSection: {
    backgroundColor: COLORS.white,
    margin: SPACING.md,
    borderRadius: 16,
    padding: SPACING.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.lg,
  },
  barChart: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 150,
  },
  barItem: {
    alignItems: 'center',
    flex: 1,
  },
  barContainer: {
    height: 100,
    width: 40,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    borderRadius: 8,
    minHeight: 4,
  },
  barValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: SPACING.xs,
  },
  barLabel: {
    fontSize: 10,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: 2,
  },
  pieChartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pieChart: {
    flex: 1,
  },
  pieSliceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  pieSliceIndicator: {
    width: 16,
    height: 16,
    borderRadius: 4,
    marginRight: SPACING.sm,
  },
  pieSliceLabel: {
    fontSize: 14,
    color: COLORS.text,
  },
  pieTotalContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 6,
    borderColor: COLORS.primary,
  },
  pieTotalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  pieTotalLabel: {
    fontSize: 10,
    color: COLORS.gray,
  },
  activitySection: {
    backgroundColor: COLORS.white,
    margin: SPACING.md,
    borderRadius: 16,
    padding: SPACING.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  activityCards: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  activityCard: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: SPACING.md,
    alignItems: 'center',
  },
  activityValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  activityLabel: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: SPACING.xs,
  },
  actionsContainer: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  actionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  actionButton: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButtonIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  actionButtonText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  actionButtonBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 12,
  },
  actionButtonBadgeText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  accessDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  accessDeniedIcon: {
    fontSize: 64,
    marginBottom: SPACING.lg,
  },
  accessDeniedText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  accessDeniedSubtext: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: 'center',
  },
  rtlText: {
    textAlign: 'right',
  },
  rtlRow: {
    flexDirection: 'row-reverse',
  },
});

export default AdminDashboardScreen;

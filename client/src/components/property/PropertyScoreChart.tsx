import React from 'react';
import { 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type PropertyScores = {
  locationScore: number;
  valueScore: number;
  amenitiesScore: number;
  conditionScore: number;
  investmentScore: number;
  overallScore: number;
};

// Default values if property scores are missing
const DEFAULT_SCORES: PropertyScores = {
  locationScore: 70,
  valueScore: 65,
  amenitiesScore: 60,
  conditionScore: 75,
  investmentScore: 68,
  overallScore: 70,
};

interface PropertyScoreChartProps {
  scores?: Partial<PropertyScores>;
  className?: string;
  showTooltip?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const PropertyScoreChart: React.FC<PropertyScoreChartProps> = ({
  scores,
  className,
  showTooltip = true,
  size = 'md',
}) => {
  const { t } = useTranslation();
  
  // Merge provided scores with defaults for any missing values
  const fullScores: PropertyScores = {
    ...DEFAULT_SCORES,
    ...scores,
  };
  
  // Transform scores into the format expected by the RadarChart
  const chartData = [
    {
      category: t('score.location'),
      value: fullScores.locationScore,
      fullMark: 100,
    },
    {
      category: t('score.value'),
      value: fullScores.valueScore,
      fullMark: 100,
    },
    {
      category: t('score.amenities'),
      value: fullScores.amenitiesScore,
      fullMark: 100,
    },
    {
      category: t('score.condition'),
      value: fullScores.conditionScore,
      fullMark: 100,
    },
    {
      category: t('score.investment'),
      value: fullScores.investmentScore,
      fullMark: 100,
    },
  ];

  // Calculate average overall score
  const averageScore = Math.round(
    (fullScores.locationScore +
      fullScores.valueScore +
      fullScores.amenitiesScore +
      fullScores.conditionScore +
      fullScores.investmentScore) / 5
  );

  // Determine size classes
  const sizeClasses = {
    sm: 'h-44 w-44',
    md: 'h-64 w-64',
    lg: 'h-80 w-80',
  };

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="text-center mb-2">
        <div className="text-sm text-gray-500">{t('score.propertyScore')}</div>
        <div className="flex items-center justify-center gap-1">
          <span className="text-3xl font-bold text-primary">
            {fullScores.overallScore || averageScore}
          </span>
          <span className="text-sm text-gray-500">/100</span>
        </div>
      </div>
      <div className={cn(sizeClasses[size])}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={chartData}>
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis
              dataKey="category"
              tick={{ fill: '#64748b', fontSize: size === 'sm' ? 10 : 12 }}
            />
            {showTooltip && (
              <Tooltip
                formatter={(value: number) => [`${value}/100`, '']}
                labelFormatter={() => ''}
                contentStyle={{
                  backgroundColor: 'white',
                  borderRadius: '0.375rem',
                  border: 'none',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                }}
              />
            )}
            <Radar
              name="Score"
              dataKey="value"
              stroke="#3bcac4"
              fill="#3bcac4"
              fillOpacity={0.4}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-primary-900"></div>
          <span>{t('score.location')}: </span>
          <span className="font-semibold">{fullScores.locationScore}/100</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-primary-900"></div>
          <span>{t('score.value')}: </span>
          <span className="font-semibold">{fullScores.valueScore}/100</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-primary-900"></div>
          <span>{t('score.amenities')}: </span>
          <span className="font-semibold">{fullScores.amenitiesScore}/100</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-primary-900"></div>
          <span>{t('score.condition')}: </span>
          <span className="font-semibold">{fullScores.conditionScore}/100</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-primary-900"></div>
          <span>{t('score.investment')}: </span>
          <span className="font-semibold">{fullScores.investmentScore}/100</span>
        </div>
      </div>
    </div>
  );
};

export default PropertyScoreChart;
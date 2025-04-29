import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface PropertyScoreBadgeProps {
  score: number;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
  className?: string;
}

export const PropertyScoreBadge: React.FC<PropertyScoreBadgeProps> = ({
  score,
  size = 'small',
  showLabel = false,
  className
}) => {
  const { t } = useTranslation();

  const getScoreLabel = (score: number): string => {
    if (score >= 90) return t('score.excellent');
    if (score >= 80) return t('score.good');
    if (score >= 70) return t('score.average');
    if (score >= 60) return t('score.fair');
    return t('score.poor');
  };

  const getScoreColor = (score: number): string => {
    if (score >= 90) return 'bg-green-600 text-white';
    if (score >= 80) return 'bg-green-500 text-white';
    if (score >= 70) return 'bg-yellow-500 text-white';
    if (score >= 60) return 'bg-orange-500 text-white';
    return 'bg-red-500 text-white';
  };

  const getSizeClasses = (): string => {
    switch (size) {
      case 'large':
        return 'text-xl py-2 px-4 min-w-[60px] h-[60px]';
      case 'medium':
        return 'text-base py-1.5 px-3 min-w-[48px] h-[48px]';
      case 'small':
      default:
        return 'text-sm py-1 px-2 min-w-[36px] h-[36px]';
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div
        className={cn(
          'rounded-full font-bold flex items-center justify-center',
          getScoreColor(score),
          getSizeClasses(),
          className
        )}
      >
        {Math.round(score)}
      </div>
      {showLabel && (
        <span className="text-xs text-gray-600 mt-1">{getScoreLabel(score)}</span>
      )}
    </div>
  );
};
import React from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface PropertyScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export const PropertyScoreBadge: React.FC<PropertyScoreBadgeProps> = ({
  score,
  size = 'md',
  showLabel = true,
  className,
}) => {
  const { t } = useTranslation();
  
  // Calculate color based on score
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'bg-green-500';
    if (score >= 80) return 'bg-green-400';
    if (score >= 70) return 'bg-green-300';
    if (score >= 60) return 'bg-yellow-400';
    if (score >= 50) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-400';
    return 'bg-red-500';
  };

  // Calculate size classes based on size prop
  const sizeClasses = {
    sm: {
      badge: 'h-8 w-8 text-xs',
      container: 'gap-1',
      label: 'text-xs',
    },
    md: {
      badge: 'h-10 w-10 text-sm',
      container: 'gap-1.5',
      label: 'text-sm',
    },
    lg: {
      badge: 'h-14 w-14 text-lg font-bold',
      container: 'gap-2',
      label: 'text-base',
    },
  };

  return (
    <div className={cn('flex items-center', sizeClasses[size].container, className)}>
      <div
        className={cn(
          'rounded-full flex items-center justify-center text-white',
          getScoreColor(score),
          sizeClasses[size].badge
        )}
      >
        {score}
      </div>
      {showLabel && (
        <span className={cn('text-gray-600', sizeClasses[size].label)}>
          {t('score.propertyScore')}
        </span>
      )}
    </div>
  );
};

export default PropertyScoreBadge;
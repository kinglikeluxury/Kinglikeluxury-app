import React from 'react';
import { useTranslation } from 'react-i18next';

type ScoreKey = 'location' | 'value' | 'amenities' | 'condition' | 'investment';

interface PropertyScores {
  location: number;
  value: number;
  amenities: number;
  condition: number;
  investment: number;
}

interface PropertyScoreChartProps {
  scores: Partial<PropertyScores>;
  size?: number;
}

const PropertyScoreChart: React.FC<PropertyScoreChartProps> = ({ 
  scores, 
  size = 300 
}) => {
  const { t } = useTranslation();
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size * 0.4;
  
  const allScoreKeys: ScoreKey[] = ['location', 'value', 'amenities', 'condition', 'investment'];
  
  // Default all scores to 0 if not provided
  const normalizedScores: PropertyScores = {
    location: scores.location || 0,
    value: scores.value || 0,
    amenities: scores.amenities || 0,
    condition: scores.condition || 0,
    investment: scores.investment || 0,
  };
  
  // Calculate point positions
  const calculatePoint = (index: number, score: number) => {
    const angle = (index / allScoreKeys.length) * Math.PI * 2 - Math.PI / 2;
    const normalizedScore = Math.max(0, Math.min(score, 100)) / 100;
    const distance = radius * normalizedScore;
    
    return {
      x: centerX + distance * Math.cos(angle),
      y: centerY + distance * Math.sin(angle),
    };
  };
  
  // Generate axis lines and labels
  const axisLines = allScoreKeys.map((key, index) => {
    const angle = (index / allScoreKeys.length) * Math.PI * 2 - Math.PI / 2;
    const endX = centerX + radius * Math.cos(angle);
    const endY = centerY + radius * Math.sin(angle);
    
    // Position for labels (slightly beyond the axis line)
    const labelDistance = radius * 1.15;
    const labelX = centerX + labelDistance * Math.cos(angle);
    const labelY = centerY + labelDistance * Math.sin(angle);
    
    return (
      <g key={key}>
        <line
          x1={centerX}
          y1={centerY}
          x2={endX}
          y2={endY}
          stroke="#ddd"
          strokeWidth="1"
        />
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fill="#666"
        >
          {t(`score.${key}`)}
        </text>
      </g>
    );
  });
  
  // Generate background rings
  const rings = [0.2, 0.4, 0.6, 0.8, 1].map((ratio, index) => (
    <circle
      key={`ring-${index}`}
      cx={centerX}
      cy={centerY}
      r={radius * ratio}
      fill="none"
      stroke="#eee"
      strokeWidth="1"
    />
  ));
  
  // Generate data points and polygon
  const dataPoints = allScoreKeys.map((key, index) => 
    calculatePoint(index, normalizedScores[key])
  );
  
  const polygonPoints = dataPoints.map(point => `${point.x},${point.y}`).join(' ');
  
  return (
    <div className="flex justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background rings */}
        {rings}
        
        {/* Axis lines and labels */}
        {axisLines}
        
        {/* Data polygon */}
        <polygon
          points={polygonPoints}
          fill="rgba(59, 202, 196, 0.5)"
          stroke="#3bcac4"
          strokeWidth="2"
        />
        
        {/* Data points */}
        {dataPoints.map((point, index) => (
          <circle
            key={`point-${index}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#3bcac4"
            stroke="#fff"
            strokeWidth="1"
          />
        ))}
      </svg>
    </div>
  );
};

export default PropertyScoreChart;
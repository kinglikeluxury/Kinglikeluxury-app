import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTranslation } from 'react-i18next';

interface Country {
  code: string;
  dial: string;
  flag: string;
}

const countries: Country[] = [
  { code: 'AF', dial: '+93', flag: '🇦🇫' },
  { code: 'AL', dial: '+355', flag: '🇦🇱' },
  { code: 'DZ', dial: '+213', flag: '🇩🇿' },
  { code: 'AD', dial: '+376', flag: '🇦🇩' },
  { code: 'AO', dial: '+244', flag: '🇦🇴' },
  { code: 'AR', dial: '+54', flag: '🇦🇷' },
  { code: 'AM', dial: '+374', flag: '🇦🇲' },
  { code: 'AU', dial: '+61', flag: '🇦🇺' },
  { code: 'AT', dial: '+43', flag: '🇦🇹' },
  { code: 'AZ', dial: '+994', flag: '🇦🇿' },
  { code: 'BH', dial: '+973', flag: '🇧🇭' },
  { code: 'BD', dial: '+880', flag: '🇧🇩' },
  { code: 'BY', dial: '+375', flag: '🇧🇾' },
  { code: 'BE', dial: '+32', flag: '🇧🇪' },
  { code: 'BR', dial: '+55', flag: '🇧🇷' },
  { code: 'BG', dial: '+359', flag: '🇧🇬' },
  { code: 'CA', dial: '+1', flag: '🇨🇦' },
  { code: 'CL', dial: '+56', flag: '🇨🇱' },
  { code: 'CN', dial: '+86', flag: '🇨🇳' },
  { code: 'CO', dial: '+57', flag: '🇨🇴' },
  { code: 'HR', dial: '+385', flag: '🇭🇷' },
  { code: 'CY', dial: '+357', flag: '🇨🇾' },
  { code: 'CZ', dial: '+420', flag: '🇨🇿' },
  { code: 'DK', dial: '+45', flag: '🇩🇰' },
  { code: 'EG', dial: '+20', flag: '🇪🇬' },
  { code: 'EE', dial: '+372', flag: '🇪🇪' },
  { code: 'ET', dial: '+251', flag: '🇪🇹' },
  { code: 'FI', dial: '+358', flag: '🇫🇮' },
  { code: 'FR', dial: '+33', flag: '🇫🇷' },
  { code: 'GE', dial: '+995', flag: '🇬🇪' },
  { code: 'DE', dial: '+49', flag: '🇩🇪' },
  { code: 'GR', dial: '+30', flag: '🇬🇷' },
  { code: 'HK', dial: '+852', flag: '🇭🇰' },
  { code: 'HU', dial: '+36', flag: '🇭🇺' },
  { code: 'IS', dial: '+354', flag: '🇮🇸' },
  { code: 'IN', dial: '+91', flag: '🇮🇳' },
  { code: 'ID', dial: '+62', flag: '🇮🇩' },
  { code: 'IR', dial: '+98', flag: '🇮🇷' },
  { code: 'IQ', dial: '+964', flag: '🇮🇶' },
  { code: 'IE', dial: '+353', flag: '🇮🇪' },
  { code: 'IL', dial: '+972', flag: '🇮🇱' },
  { code: 'IT', dial: '+39', flag: '🇮🇹' },
  { code: 'JP', dial: '+81', flag: '🇯🇵' },
  { code: 'JO', dial: '+962', flag: '🇯🇴' },
  { code: 'KZ', dial: '+7', flag: '🇰🇿' },
  { code: 'KE', dial: '+254', flag: '🇰🇪' },
  { code: 'KW', dial: '+965', flag: '🇰🇼' },
  { code: 'KG', dial: '+996', flag: '🇰🇬' },
  { code: 'LV', dial: '+371', flag: '🇱🇻' },
  { code: 'LB', dial: '+961', flag: '🇱🇧' },
  { code: 'LY', dial: '+218', flag: '🇱🇾' },
  { code: 'LT', dial: '+370', flag: '🇱🇹' },
  { code: 'LU', dial: '+352', flag: '🇱🇺' },
  { code: 'MY', dial: '+60', flag: '🇲🇾' },
  { code: 'MX', dial: '+52', flag: '🇲🇽' },
  { code: 'MA', dial: '+212', flag: '🇲🇦' },
  { code: 'NL', dial: '+31', flag: '🇳🇱' },
  { code: 'NZ', dial: '+64', flag: '🇳🇿' },
  { code: 'NG', dial: '+234', flag: '🇳🇬' },
  { code: 'NO', dial: '+47', flag: '🇳🇴' },
  { code: 'OM', dial: '+968', flag: '🇴🇲' },
  { code: 'PK', dial: '+92', flag: '🇵🇰' },
  { code: 'PS', dial: '+970', flag: '🇵🇸' },
  { code: 'PH', dial: '+63', flag: '🇵🇭' },
  { code: 'PL', dial: '+48', flag: '🇵🇱' },
  { code: 'PT', dial: '+351', flag: '🇵🇹' },
  { code: 'QA', dial: '+974', flag: '🇶🇦' },
  { code: 'RO', dial: '+40', flag: '🇷🇴' },
  { code: 'RU', dial: '+7', flag: '🇷🇺' },
  { code: 'SA', dial: '+966', flag: '🇸🇦' },
  { code: 'RS', dial: '+381', flag: '🇷🇸' },
  { code: 'SG', dial: '+65', flag: '🇸🇬' },
  { code: 'SK', dial: '+421', flag: '🇸🇰' },
  { code: 'SI', dial: '+386', flag: '🇸🇮' },
  { code: 'ZA', dial: '+27', flag: '🇿🇦' },
  { code: 'KR', dial: '+82', flag: '🇰🇷' },
  { code: 'ES', dial: '+34', flag: '🇪🇸' },
  { code: 'LK', dial: '+94', flag: '🇱🇰' },
  { code: 'SE', dial: '+46', flag: '🇸🇪' },
  { code: 'CH', dial: '+41', flag: '🇨🇭' },
  { code: 'SY', dial: '+963', flag: '🇸🇾' },
  { code: 'TW', dial: '+886', flag: '🇹🇼' },
  { code: 'TH', dial: '+66', flag: '🇹🇭' },
  { code: 'TN', dial: '+216', flag: '🇹🇳' },
  { code: 'TR', dial: '+90', flag: '🇹🇷' },
  { code: 'TM', dial: '+993', flag: '🇹🇲' },
  { code: 'UA', dial: '+380', flag: '🇺🇦' },
  { code: 'AE', dial: '+971', flag: '🇦🇪' },
  { code: 'GB', dial: '+44', flag: '🇬🇧' },
  { code: 'US', dial: '+1', flag: '🇺🇸' },
  { code: 'UZ', dial: '+998', flag: '🇺🇿' },
  { code: 'VN', dial: '+84', flag: '🇻🇳' },
  { code: 'YE', dial: '+967', flag: '🇾🇪' },
];

const ALL_LOCALES = ['en', 'ar', 'ru', 'tr', 'zh', 'pl', 'ka', 'he', 'az', 'it'];

function getLocalizedName(code: string, locale: string): string {
  try {
    const displayNames = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

// Pre-build a search index with country names in ALL supported languages
// so searching works regardless of the current UI language
const allLanguageNamesIndex: Record<string, string[]> = {};
for (const country of countries) {
  allLanguageNamesIndex[country.code] = ALL_LOCALES.map(loc =>
    getLocalizedName(country.code, loc).toLowerCase()
  );
}

interface CountryCodePickerProps {
  value: string;
  onChange: (dialCode: string) => void;
  disabled?: boolean;
}

export function CountryCodePicker({ value, onChange, disabled }: CountryCodePickerProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [detected, setDetected] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const locale = i18n.language || 'en';

  const countriesLocalized = useMemo(() => {
    return countries.map(c => ({
      ...c,
      name: getLocalizedName(c.code, locale),
    }));
  }, [locale]);

  const selected = useMemo(() => {
    return countriesLocalized.find(c => c.dial === value) || countriesLocalized.find(c => c.code === 'AE')!;
  }, [value, countriesLocalized]);

  useEffect(() => {
    if (detected) return;
    const detect = async () => {
      try {
        const res = await fetch('/api/geo/detect');
        const data = await res.json();
        const country = countries.find(c => c.code === data.countryCode);
        if (country) {
          onChange(country.dial);
        }
      } catch {}
      setDetected(true);
    };
    detect();
  }, [detected, onChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return countriesLocalized;
    const q = search.toLowerCase().trim();
    return countriesLocalized.filter(c =>
      // Search in current UI language name
      c.name.toLowerCase().includes(q) ||
      // Search across ALL language names (Arabic, Russian, Turkish, etc.)
      (allLanguageNamesIndex[c.code] || []).some(n => n.includes(q)) ||
      // Search by dial code or country code
      c.dial.includes(q) ||
      c.code.toLowerCase().includes(q)
    );
  }, [search, countriesLocalized]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="flex items-center gap-1 h-10 px-2 border rounded-md bg-background hover:bg-accent transition-colors text-sm min-w-[90px] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="text-lg leading-none">{selected.flag}</span>
        <span className="text-muted-foreground">{selected.dial}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="p-2 border-b sticky top-0 bg-popover">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="text"
                placeholder={t('common.searchCountry', 'Search country...')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground text-center">
                {t('common.noCountriesFound', 'No countries found')}
              </div>
            )}
            {filtered.map((country) => (
              <button
                key={country.code}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left ${
                  selected.code === country.code ? 'bg-accent/50' : ''
                }`}
                onClick={() => {
                  onChange(country.dial);
                  setOpen(false);
                  setSearch('');
                }}
              >
                <span className="text-lg leading-none">{country.flag}</span>
                <span className="flex-1 truncate">{country.name}</span>
                <span className="text-muted-foreground text-xs">{country.dial}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

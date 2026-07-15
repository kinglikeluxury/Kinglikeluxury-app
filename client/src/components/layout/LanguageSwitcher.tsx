import { useTranslation } from "react-i18next";
import { languages } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const normalized = (i18n.language || '').toLowerCase().replace(/_/g, '-');
  const base = normalized.split('-')[0];
  const currentLang = languages[normalized as keyof typeof languages] || languages[base as keyof typeof languages];
  const currentEmoji = currentLang?.flagEmoji;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 flex items-center gap-1 px-2">
          {currentEmoji
            ? <span className="text-lg leading-none">{currentEmoji}</span>
            : <Globe className="h-4 w-4" />
          }
          <span className="sr-only">Switch language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {Object.entries(languages).map(([code, { name, flagEmoji }]) => (
          <DropdownMenuItem
            key={code}
            onClick={() => changeLanguage(code)}
            className={i18n.language === code ? "bg-accent font-semibold" : ""}
          >
            <span className="text-lg leading-none mr-2">{flagEmoji}</span>
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

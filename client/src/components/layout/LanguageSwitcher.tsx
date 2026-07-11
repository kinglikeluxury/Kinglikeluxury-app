import { useTranslation } from "react-i18next";
import { languages, getFlagUrl } from "@/lib/i18n";
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

  const currentFlagUrl = getFlagUrl(i18n.language);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 flex items-center gap-1 px-2">
          {currentFlagUrl
            ? <img src={currentFlagUrl} alt="" className="w-5 h-4 object-cover rounded-sm" />
            : <Globe className="h-4 w-4" />
          }
          <span className="sr-only">Switch language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {Object.entries(languages).map(([code, { name }]) => {
          const flagUrl = getFlagUrl(code);
          return (
            <DropdownMenuItem
              key={code}
              onClick={() => changeLanguage(code)}
              className={i18n.language === code ? "bg-accent font-semibold" : ""}
            >
              {flagUrl
                ? <img src={flagUrl} alt="" className="w-5 h-4 object-cover rounded-sm mr-2" />
                : <Globe className="h-4 w-4 mr-2" />
              }
              {name}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

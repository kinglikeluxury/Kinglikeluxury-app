import { Menu, ShieldCheck, Sparkles } from "lucide-react";
import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type KayWorkspaceProps = {
  children: ReactNode;
  title: string;
  subtitle: string;
  admin?: boolean;
  aside?: ReactNode;
  actions?: ReactNode;
};

const baseItems = [
  { label: "My Sales", href: "/admin/kay/my-sales" },
  { label: "Priority", href: "/admin/kay/my-sales#priority" },
  { label: "Follow-ups", href: "/admin/kay/my-sales#follow-ups" },
  { label: "Rescue Watch", href: "/admin/kay/my-sales#rescue" },
];

export function KayWorkspace({
  children,
  title,
  subtitle,
  admin = false,
  aside,
  actions,
}: KayWorkspaceProps) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const items = admin
    ? [...baseItems, { label: "Control Center", href: "/admin/kay-control-center" }]
    : baseItems;
  const navigation = (
    <nav aria-label="Kay navigation" className="flex h-full flex-col">
      <Link href="/admin/kay/my-sales" className="mb-8 flex items-center gap-3 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#005476] text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <span>
          <strong className="block text-sm tracking-tight text-[#005476]">Kay</strong>
          <small className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#6b8a91]">
            Sales intelligence
          </small>
        </span>
      </Link>
      <div className="space-y-1">
        {items.map((item) =>
          item.href.includes("#") ? (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="kay-nav-link block rounded-lg px-3 py-2.5 text-sm"
            >
              {item.label}
            </a>
          ) : (
            <Link
              key={item.label}
              href={item.href}
              data-active={location === item.href}
              onClick={() => setOpen(false)}
              className="kay-nav-link block rounded-lg px-3 py-2.5 text-sm"
            >
              {item.label}
            </Link>
          ),
        )}
      </div>
      <div className="mt-auto rounded-xl border border-[#d2e8e5] bg-[#f1fbfa] p-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[#005476]">
          <span className="kay-dot" />
          Kay intelligence
        </div>
        <p className="mt-2 text-xs leading-5 text-[#638087]">
          Read-only recommendations. Your CRM remains unchanged.
        </p>
      </div>
    </nav>
  );
  return (
    <div className="kay-workspace min-h-[100dvh]">
      <aside className="kay-desktop-sidebar fixed inset-y-0 left-0 z-30 w-60 border-r border-[#d9e7e6] bg-[#fbfdfd] p-5">
        {navigation}
      </aside>
      <header className="sticky top-0 z-20 border-b border-[#d9e7e6] bg-[#f4f8f8]/92 backdrop-blur">
        <div className="mx-auto flex max-w-[1540px] items-center gap-3 px-4 py-3 md:ml-60 md:px-8">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="Open Kay navigation"
                className="grid h-10 w-10 place-items-center rounded-lg border border-[#d9e7e6] bg-[#fbfdfd] text-[#005476] md:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[280px] max-w-[85vw] border-[#d9e7e6] bg-[#fbfdfd] p-5"
            >
              <SheetHeader>
                <SheetTitle className="sr-only">Kay navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Navigate your Kay sales intelligence workspace.
                </SheetDescription>
              </SheetHeader>
              {navigation}
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#59838a]">
              Kinglike Luxury · Kay
            </p>
            <h1 className="truncate text-lg font-extrabold text-[#005476]">{title}</h1>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#cde7e4] bg-[#f8fffe] px-3 py-1.5 text-xs font-semibold text-[#176b70] sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" /> Safe read-only mode
          </div>
          {actions}
        </div>
      </header>
      <main className="mx-auto max-w-[1540px] px-4 py-6 md:ml-60 md:px-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <p className="max-w-2xl text-sm leading-6 text-[#55737c]">{subtitle}</p>
        </div>
        <div
          className={
            aside ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_270px]" : ""
          }
        >
          <div className="min-w-0">{children}</div>
          {aside && <aside className="hidden xl:block">{aside}</aside>}
        </div>
      </main>
    </div>
  );
}

export function KayEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-4 text-sm">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e2f5f2] text-lg font-bold text-[#16736e]">
        ✓
      </span>
      <span>
        <b className="block text-[#005476]">{title}</b>
        <span className="text-[#66838a]">{detail}</span>
      </span>
    </div>
  );
}
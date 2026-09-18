import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarClock, ExternalLink, Flag, Headphones, ShieldAlert, Target, Timer, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";
import { type ReactNode, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { KayEmpty, KayWorkspace } from "@/components/kay/KayWorkspace";
import {
  adaptAvailability,
  adaptBriefingsPayload,
  adaptCommitmentsPayload,
  adaptHandoffsPayload,
  adaptMissionData,
  adaptPromisesPayload,
  adaptVoiceSettings,
  completedToday,
  groupPromises,
  type KayAvailability,
  type KayBriefing,
  type KayCommitment,
  type KayHandoff,
  type KayMission,
  type KayMissionData,
  type KayPromise,
  type KayVoiceSettings,
} from "@/components/kay/kaySalesAdapters";

type QueryState = {
  isLoading: boolean;
  isError: boolean;
  isFetching?: boolean;
  refetch: () => unknown;
};

type DataQuery<T> = QueryState & {
  data?: T;
};

const read = <T,>(path: string, adapt: (raw: unknown) => T) => async (): Promise<T> => {
  const response = await apiRequest("GET", path);
  return adapt(await response.json());
};

const displayDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "No due time reported";

const titleFor = (mission: KayMission) =>
  mission.missionType.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

export default function KayMySalesPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const allowed = !!user && (!!user.isAdmin || user.role === "sub_agent");

  useEffect(() => {
    if (!authLoading && !allowed) navigate("/");
  }, [allowed, authLoading, navigate]);

  const missions = useQuery<KayMissionData>({
    queryKey: ["/api/kay/missions"],
    queryFn: read("/api/kay/missions", adaptMissionData),
    enabled: allowed,
  });
  const completed = useQuery<KayMissionData>({
    queryKey: ["/api/kay/missions", "completed"],
    queryFn: read("/api/kay/missions?completed=true", adaptMissionData),
    enabled: allowed,
  });
  const briefings = useQuery<{ briefings: KayBriefing[] }>({
    queryKey: ["/api/kay/briefings"],
    queryFn: read("/api/kay/briefings", adaptBriefingsPayload),
    enabled: allowed,
  });
  const commitments = useQuery<{ commitments: KayCommitment[] }>({
    queryKey: ["/api/kay/commitments"],
    queryFn: read("/api/kay/commitments", adaptCommitmentsPayload),
    enabled: allowed,
  });
  const promises = useQuery<{ promises: KayPromise[] }>({
    queryKey: ["/api/kay/promises"],
    queryFn: read("/api/kay/promises", adaptPromisesPayload),
    enabled: allowed,
  });
  const handoffs = useQuery<{ handoffs: KayHandoff[] }>({
    queryKey: ["/api/kay/promise-handoffs"],
    queryFn: read("/api/kay/promise-handoffs", adaptHandoffsPayload),
    enabled: allowed,
  });
  const availability = useQuery<KayAvailability>({
    queryKey: ["/api/kay/availability"],
    queryFn: read("/api/kay/availability", adaptAvailability),
    enabled: allowed,
  });
  const voice = useQuery<KayVoiceSettings>({
    queryKey: ["/api/kay/settings/phase-d"],
    queryFn: read("/api/kay/settings/phase-d", adaptVoiceSettings),
    enabled: allowed,
  });

  useEffect(() => {
    const refresh = () => {
      void Promise.all([
        missions.refetch(),
        completed.refetch(),
        briefings.refetch(),
        commitments.refetch(),
        promises.refetch(),
        handoffs.refetch(),
        availability.refetch(),
        voice.refetch(),
      ]);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [missions.refetch, completed.refetch, briefings.refetch, commitments.refetch,
    promises.refetch, handoffs.refetch, availability.refetch, voice.refetch]);

  const all = missions.data?.missions ?? [];
  const focus = missions.data?.next60Minutes ?? [];
  const priority = all.filter((item) => item.priority === "CRITICAL" || item.priority === "HIGH");
  const followUps = all.filter((item) => item.missionType === "FOLLOW_UP_DUE");
  const rescue = all.filter((item) => item.missionType === "RESCUE_RISK");
  const unprotected = all.filter((item) => item.missionType === "UNPROTECTED_LEAD");
  const completedMissions = completed.data?.missions ?? [];
  const completedTodayMissions = completedToday(completedMissions);
  const groups = useMemo(
    () => groupPromises(promises.data?.promises ?? []),
    [promises.data?.promises],
  );

  if (authLoading || !allowed) return null;

  const initial =
    (user as { firstName?: string; name?: string })?.firstName ||
    (user as { name?: string })?.name;
  const heading = missions.isLoading
    ? "Preparing your sales view"
    : missions.isError
      ? "Your pipeline view is unavailable"
      : priority.length
        ? `${priority.length} ${priority.length === 1 ? "priority needs" : "priorities need"} your attention`
        : "You’re clear right now";

  const aside = (
    <KayTodayPanel
      priority={priority}
      rescueCount={rescue.length}
      promiseGroups={groups}
      missionsQuery={missions}
      promisesQuery={promises}
      availabilityQuery={availability}
    />
  );

  return (
    <KayWorkspace
      title="My Sales"
      subtitle="A focused view of the work Kay has surfaced. Recommendations are read-only; CRM changes stay in the normal CRM."
      aside={aside}
    >
      <section className="kay-appear mb-6 rounded-2xl bg-[#005476] px-5 py-6 text-white sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-[#a8e7e3]">
              {initial ? `Good to see you, ${initial}.` : "Your personal sales workspace."}
            </p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {heading}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-white/75">
              Kay is monitoring your active pipeline. CRM remains unchanged.
            </p>
            <p className="mt-3 text-xs text-[#bcefeb]">
              <b>Permanent Kay rule:</b> Kay is recommendation-only and never changes CRM owner or status.
            </p>
          </div>
          <div className="hidden rounded-2xl border border-white/15 bg-white/10 p-3 sm:block">
            <Target className="h-6 w-6 text-[#78e0db]" />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            {
              value: missions.isLoading || missions.isError ? null : priority.length,
              label: "Priority now",
              Icon: Flag,
            },
            {
              value: missions.isLoading || missions.isError ? null : followUps.length,
              label: "Follow-ups",
              Icon: Timer,
            },
            {
              value: missions.isLoading || missions.isError ? null : rescue.length,
              label: "Rescue risk",
              Icon: ShieldAlert,
            },
            {
              value: promises.isLoading || promises.isError
                ? null
                : groups[0][1].length + groups[1][1].length,
              label: "Promises due",
              Icon: CalendarClock,
            },
          ] as { value: number | null; label: string; Icon: LucideIcon }[]
        ).map(({ value, label, Icon }) => (
          <div key={label} className="kay-surface rounded-xl p-4">
            <Icon className="h-4 w-4 text-[#168c8a]" />
            <p className="mt-3 text-2xl font-extrabold text-[#005476]">{value ?? "—"}</p>
            <p className="text-xs font-semibold text-[#67848a]">{label}</p>
          </div>
        ))}
      </section>

      <section className="kay-appear mt-6 rounded-2xl border border-[#b9e4e0] bg-[#edfafa] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#267c7d]">Focus now</p>
            <h2 className="mt-1 text-xl font-extrabold text-[#005476]">Your next 60 minutes</h2>
          </div>
          <span className="kay-mono text-xs text-[#568087]">
            MAX {missions.data?.maxNext60MinutesItems ?? "—"}
          </span>
        </div>
        {missions.isLoading ? (
          <Skeleton lines={3} />
        ) : missions.isError ? (
          <ErrorRead retry={() => void missions.refetch()} label="Focus recommendations are temporarily unavailable." />
        ) : focus.length ? (
          <div className="mt-4 divide-y divide-[#cbe9e6]">
            {focus.slice(0, 3).map((mission, index) => (
              <MissionItem key={mission.id} mission={mission} index={index + 1} featured />
            ))}
          </div>
        ) : (
          <KayEmpty title="You’re clear for the next hour" detail="Kay will surface anything that needs attention." />
        )}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Feed
          id="priority"
          title="Priority queue"
          eyebrow="Ranked by Kay"
          icon={<Flag className="h-4 w-4" />}
          items={priority}
          loading={missions.isLoading}
          error={missions.isError}
          retry={() => void missions.refetch()}
          empty={["All clear — no urgent priorities.", "The pipeline has no high-priority review waiting."]}
        />
        <Feed
          id="rescue"
          title="Rescue watch"
          eyebrow="Human review only"
          icon={<ShieldAlert className="h-4 w-4" />}
          items={rescue}
          loading={missions.isLoading}
          error={missions.isError}
          retry={() => void missions.refetch()}
          empty={["No rescue risks detected.", "Kay has no rescue recommendation for you right now."]}
        />
      </section>

      <section id="follow-ups" className="mt-6">
        <Feed
          title="Follow-ups"
          eyebrow="Timing-sensitive work"
          icon={<Timer className="h-4 w-4" />}
          items={followUps}
          loading={missions.isLoading}
          error={missions.isError}
          retry={() => void missions.refetch()}
          empty={["No follow-ups due right now.", "New timing-sensitive recommendations will appear here."]}
        />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Feed
          title="Unprotected opportunities"
          eyebrow="Needs review"
          icon={<ShieldAlert className="h-4 w-4" />}
          items={unprotected}
          loading={missions.isLoading}
          error={missions.isError}
          retry={() => void missions.refetch()}
          empty={["No unprotected opportunities.", "Kay has no unprotected lead recommendation right now."]}
        />
        <Feed
          title="Completed today"
          eyebrow="History"
          icon={<Target className="h-4 w-4" />}
          items={completedTodayMissions}
          loading={completed.isLoading}
          error={completed.isError}
          retry={() => void completed.refetch()}
          empty={["No completed actions yet today.", "Completed mission history will appear here."]}
        />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Commitments query={commitments} />
        <Promises groups={groups} query={promises} />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Briefings query={briefings} voiceQuery={voice} />
        <Handoffs query={handoffs} />
      </section>
    </KayWorkspace>
  );
}

function KayTodayPanel({
  priority,
  rescueCount,
  promiseGroups,
  missionsQuery,
  promisesQuery,
  availabilityQuery,
}: {
  priority: KayMission[];
  rescueCount: number;
  promiseGroups: ReadonlyArray<readonly [string, KayPromise[]]>;
  missionsQuery: QueryState;
  promisesQuery: QueryState;
  availabilityQuery: DataQuery<KayAvailability>;
}) {
  const promisesDue =
    promiseGroups[0][1].length + promiseGroups[1][1].length;

  return (
    <div className="sticky top-24 space-y-4">
      <div className="kay-surface rounded-2xl p-4">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#64878d]">Kay today</p>
        <dl className="mt-4 space-y-3 text-sm">
          <Insight
            label="Top priority"
            value={priority[0]?.objective ?? "No urgent priority"}
            query={missionsQuery}
          />
          <Insight label="Rescue risk" value={`${rescueCount} identified`} query={missionsQuery} />
          <Insight label="Promises due" value={`${promisesDue} due or overdue`} query={promisesQuery} />
          <Insight
            label="Availability"
            value={availabilityQuery.data?.availability || "Not reported"}
            query={availabilityQuery}
          />
        </dl>
      </div>
      <div className="rounded-2xl bg-[#005476] p-4 text-white">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#91dcd8]">Kay insight</p>
        <p className="mt-2 text-sm leading-6 text-white/90">
          {missionsQuery.isLoading
            ? "Kay is loading your ranked recommendations."
            : missionsQuery.isError
              ? "Kay recommendations are temporarily unavailable."
              : priority.length
                ? "Start with the first ranked recommendation; Kay has surfaced it because it needs a human review."
                : "No urgent recommendation is currently waiting. Kay will surface changes in your pipeline."}
        </p>
      </div>
    </div>
  );
}

function Insight({
  label,
  value,
  query,
}: {
  label: string;
  value: string;
  query: QueryState;
}) {
  return (
    <div>
      <dt className="text-xs text-[#6b898f]">{label}</dt>
      <dd className="mt-0.5 font-semibold text-[#164f66]">
        <QueryValue query={query} value={value} />
      </dd>
    </div>
  );
}

function QueryValue({ query, value }: { query: QueryState; value: string }) {
  if (query.isLoading) return <span className="text-[#6b898f]">Loading…</span>;
  if (query.isError) {
    return (
      <button
        type="button"
        className="font-semibold text-[#8a5b40] underline decoration-dotted underline-offset-2"
        onClick={() => void query.refetch()}
      >
        Unavailable · Retry
      </button>
    );
  }
  return (
    <>
      {value}
      {query.isFetching && <span className="ml-1 text-xs font-normal text-[#6b898f]">Refreshing…</span>}
    </>
  );
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="mt-4 space-y-3 animate-pulse" aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="h-12 rounded-lg bg-[#e2eeee]" />
      ))}
    </div>
  );
}

function MissionItem({
  mission,
  index,
  featured = false,
}: {
  mission: KayMission;
  index?: number;
  featured?: boolean;
}) {
  return (
    <article className={`py-4 ${featured ? "first:pt-0" : ""}`}>
      <div className="flex gap-3">
        <span className="kay-mono grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#d6f1ef] text-[10px] font-bold text-[#006b71]">
          {index ?? "•"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#087b7b]">
              {mission.priority}
            </span>
            <span className="text-xs text-[#718a90]">
              {mission.dueAt ? displayDate(mission.dueAt) : "Review timing not reported"}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-extrabold text-[#005476]">{titleFor(mission)}</h3>
          <p className="mt-1 text-sm text-[#52727b]">
            {mission.reasonDetails?.explanation || mission.objective}
          </p>
          <p className="mt-2 text-xs font-semibold text-[#176c74]">{mission.suggestedAction}</p>
          {mission.reasonDetails?.factors?.length ? (
            <details className="mt-2 text-xs text-[#668188]">
              <summary className="cursor-pointer font-semibold">Why this is priority</summary>
              {mission.reasonDetails.factors.map((factor) => (
                <p key={factor.label}>
                  {factor.label} +{factor.points}
                </p>
              ))}
            </details>
          ) : null}
          {mission.historicalObligation && (
            <p className="mt-2 text-xs text-[#745f35]">Historical obligation · supervision inactive</p>
          )}
        </div>
        {mission.leadId && (
          <Link
            href={`/admin/crm/${mission.leadId}`}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[#bedbd9] px-2 text-xs font-bold text-[#00636c]"
          >
            Open <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
    </article>
  );
}

function Feed({
  id,
  title,
  eyebrow,
  icon,
  items,
  loading,
  error,
  retry,
  empty,
}: {
  id?: string;
  title: string;
  eyebrow: string;
  icon: ReactNode;
  items: KayMission[];
  loading: boolean;
  error: boolean;
  retry: () => void;
  empty: [string, string];
}) {
  return (
    <section id={id} className="kay-surface rounded-2xl p-5">
      <div className="flex items-center gap-2 text-[#168c8a]">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#61878c]">{eyebrow}</p>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-[#005476]">{title}</h2>
        <span className="kay-mono text-xs text-[#638188]">{loading || error ? "—" : items.length}</span>
      </div>
      {loading ? (
        <Skeleton lines={3} />
      ) : error ? (
        <ErrorRead retry={retry} label={`${title} is temporarily unavailable.`} />
      ) : items.length ? (
        <div className="mt-3 divide-y divide-[#e0ebea]">
          {items.slice(0, 6).map((mission, index) => (
            <MissionItem key={mission.id} mission={mission} index={index + 1} />
          ))}
        </div>
      ) : (
        <KayEmpty title={empty[0]} detail={empty[1]} />
      )}
    </section>
  );
}

function ErrorRead({ retry, label }: { retry: () => void; label: string }) {
  return (
    <div className="mt-4 rounded-xl bg-[#f1f6f6] p-3 text-sm text-[#4e6f78]">
      <ShieldAlert className="mr-2 inline h-4 w-4 text-[#168c8a]" />
      {label}
      <Button
        size="sm"
        variant="link"
        className="ml-1 h-auto p-0 text-[#00666e]"
        onClick={retry}
      >
        Retry
      </Button>
    </div>
  );
}

function Commitments({ query }: { query: DataQuery<{ commitments: KayCommitment[] }> }) {
  const items = query.data?.commitments ?? [];
  return (
    <section className="kay-surface rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#64878d]">Your workflow</p>
          <h2 className="mt-1 text-lg font-extrabold text-[#005476]">Commitments</h2>
        </div>
        <Users className="h-5 w-5 text-[#1c9390]" />
      </div>
      {query.isLoading ? (
        <Skeleton lines={3} />
      ) : query.isError ? (
        <ErrorRead retry={() => void query.refetch()} label="Commitments are temporarily unavailable." />
      ) : items.length ? (
        <div className="mt-3 divide-y divide-[#e0ebea]">
          {items.slice(0, 4).map((item) => (
            <div className="py-3 text-sm" key={item.id}>
              <b className="block text-[#164f66]">{item.action}</b>
              <span className="text-xs text-[#6a868c]">
                {item.status} · {displayDate(item.dueAt)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <KayEmpty
          title="No commitments yet"
          detail="Commitments you create in an authorized workflow will appear here."
        />
      )}
      {!query.isError && !query.isLoading && query.isFetching && (
        <p className="mt-2 text-xs text-[#6a868c]">Refreshing commitments…</p>
      )}
    </section>
  );
}

function Briefings({
  query,
  voiceQuery,
}: {
  query: DataQuery<{ briefings: KayBriefing[] }>;
  voiceQuery: DataQuery<KayVoiceSettings>;
}) {
  const current = (query.data?.briefings ?? []).filter((item) => !item.acknowledgedAt);
  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const language = voiceQuery.data?.profile?.language ?? voiceQuery.data?.defaultLanguage;
    utterance.lang = language === "ar" ? "ar-SA" : "en-US";
    utterance.rate = Number(voiceQuery.data?.speechRate ?? 1);
    utterance.pitch = Number(voiceQuery.data?.speechPitch ?? 1);
    const preferred = voiceQuery.data?.profile?.preferredVoiceName ?? voiceQuery.data?.preferredVoiceName;
    if (preferred) {
      const selected = window.speechSynthesis.getVoices().find((item) => item.name === preferred);
      if (selected) utterance.voice = selected;
    }
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section className="rounded-2xl bg-[#e9f7f6] p-5">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-[#157b7d]" />
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#548487]">From Kay</p>
      </div>
      <h2 className="mt-1 text-lg font-extrabold text-[#005476]">Internal briefing</h2>
      {!current.length && voiceQuery.isLoading && (
        <p className="mt-3 text-xs text-[#638188]">Voice settings loading…</p>
      )}
      {!current.length && voiceQuery.isError && (
        <p className="mt-3 text-xs text-[#8a5b40]">
          Voice settings unavailable.{" "}
          <button
            type="button"
            className="font-bold underline decoration-dotted underline-offset-2"
            onClick={() => void voiceQuery.refetch()}
          >
            Retry
          </button>
        </p>
      )}
      {query.isLoading ? (
        <Skeleton lines={2} />
      ) : query.isError ? (
        <ErrorRead retry={() => void query.refetch()} label="Briefings are temporarily unavailable." />
      ) : current.length ? (
        <>
          <p className="mt-3 text-sm leading-6 text-[#1e5569]">{current[0].text}</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-bold text-[#197476]">
              {current[0].severity}
            </span>
            {voiceQuery.isLoading ? (
              <span className="text-xs text-[#638188]">Voice settings loading…</span>
            ) : voiceQuery.isError ? (
              <span className="text-xs text-[#8a5b40]">
                Voice settings unavailable.{" "}
                <button
                  type="button"
                  className="font-bold underline decoration-dotted underline-offset-2"
                  onClick={() => void voiceQuery.refetch()}
                >
                  Retry
                </button>
              </span>
            ) : voiceQuery.data?.voiceEnabled !== false ? (
              <Button
                variant="outline"
                size="sm"
                className="border-[#a9dcd8] bg-transparent text-[#00646b]"
                onClick={() => speak(current[0].text)}
              >
                <Headphones className="mr-1 h-3.5 w-3.5" />
                Listen
              </Button>
            ) : null}
          </div>
          {current[0].deepLink && (
            <Link href={current[0].deepLink} className="mt-3 inline-flex text-xs font-bold text-[#00666e]">
              Open item
            </Link>
          )}
          {current.length > 1 && (
            <details className="mt-3 text-xs text-[#638188]">
              <summary>
                {current.length - 1} earlier briefing{current.length === 2 ? "" : "s"} in history
              </summary>
              {current.slice(1).map((item) => (
                <p key={item.id} className="mt-2">
                  {item.text}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <KayEmpty title="No new briefings" detail="Kay’s next internal update will appear here." />
      )}
    </section>
  );
}

function Promises({
  groups,
  query,
}: {
  groups: ReadonlyArray<readonly [string, KayPromise[]]>;
  query: DataQuery<{ promises: KayPromise[] }>;
}) {
  const items = groups.flatMap(([, list]) => list);
  return (
    <section className="kay-surface rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#64878d]">Customer care</p>
          <h2 className="mt-1 text-lg font-extrabold text-[#005476]">Customer promises</h2>
        </div>
        <span className="text-xs font-semibold text-[#69868d]">Read-only view</span>
      </div>
      {query.isLoading ? (
        <Skeleton lines={3} />
      ) : query.isError ? (
        <ErrorRead retry={() => void query.refetch()} label="Promises are temporarily unavailable." />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {groups.map(([name, list]) => (
              <span key={name} className="rounded-full bg-[#edf5f4] px-2.5 py-1 text-xs font-semibold text-[#326a72]">
                {name} {list.length}
              </span>
            ))}
          </div>
          {items.length ? (
            <div className="mt-3 divide-y divide-[#e0ebea]">
              {items.slice(0, 5).map((item) => (
                <div className="py-3 text-sm" key={item.id}>
                  <b className="block text-[#164f66]">{item.promiseText}</b>
                  <span className="text-xs text-[#6a868c]">
                    {item.status} · {displayDate(item.dueAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <KayEmpty title="No promises due" detail="Current and completed promise timing will appear here." />
          )}
          {query.isFetching && <p className="mt-2 text-xs text-[#6a868c]">Refreshing promises…</p>}
        </>
      )}
    </section>
  );
}

function Handoffs({ query }: { query: DataQuery<{ handoffs: KayHandoff[] }> }) {
  const items = query.data?.handoffs ?? [];
  return (
    <section className="kay-surface rounded-2xl p-5">
      <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#64878d]">Continuity</p>
      <h2 className="mt-1 text-lg font-extrabold text-[#005476]">Promise handoffs</h2>
      {query.isLoading ? (
        <Skeleton lines={2} />
      ) : query.isError ? (
        <ErrorRead retry={() => void query.refetch()} label="Promise handoffs are temporarily unavailable." />
      ) : items.length ? (
        <div className="mt-3 space-y-2">
          {items.slice(0, 3).map((item) => (
            <div className="rounded-xl bg-[#f5f9f8] p-3 text-sm" key={item.id}>
              <b className="block text-[#164f66]">{item.promiseText || "Promise text not reported"}</b>
              <span className="text-xs text-[#6a868c]">
                {item.acceptedAt ? "Accepted" : "Awaiting review"} · Owner #
                {item.originalOwnerId ?? "not reported"} · {item.importance ?? "NORMAL"} ·{" "}
                {displayDate(item.dueAt)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <KayEmpty title="No handoffs waiting" detail="There are no customer promises waiting for your review." />
      )}
    </section>
  );
}
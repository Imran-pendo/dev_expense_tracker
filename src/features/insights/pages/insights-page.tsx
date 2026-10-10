import { useEffect, useRef } from "react";
import { Lightbulb } from "lucide-react";
import { AppLayout } from "@/shared/components/app-layout";
import { BpBox } from "@/shared/components/bp-box";
import { pendo } from "@/shared/lib/pendo";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthContext } from "@/features/auth/hooks/auth-context";
import { useInsights } from "../hooks/use-insights";
import { BUDGET_ADHERENCE_LABEL, healthScoreLabel } from "../lib/insights-engine";
import { ForecastCard } from "../components/forecast-card";
import { HealthScoreCard } from "../components/health-score-card";
import { AnomalyList } from "../components/anomaly-list";
import { MomDeltaTable } from "../components/mom-delta-table";
import { LargestExpenses } from "../components/largest-expenses";

export function InsightsPage() {
  const { workspace } = useAuthContext();
  const insights = useInsights(workspace!.id);

  // Once per visit to this page: the ref resets when the page remounts (a new
  // visit) but not when useDataChanged reloads the data (e.g. a Quick Add
  // save). The dashboard's InsightsStrip shares the hook and is not tracked.
  const hasTrackedVisitRef = useRef(false);
  useEffect(() => {
    if (insights.isLoading || !insights.hasTransactions || hasTrackedVisitRef.current) return;
    hasTrackedVisitRef.current = true;
    const topAnomaly = insights.anomalies[0];
    const { vsBaseline, baselineAverage } = insights.forecast;
    pendo.track("insights_generated", {
      healthScore: insights.health.score,
      healthLabel: healthScoreLabel(insights.health.score),
      anomalyCount: insights.anomalies.length,
      topAnomalyCategory: topAnomaly?.category.name ?? null,
      topAnomalyRatio: topAnomaly ? Number(topAnomaly.ratio.toFixed(1)) : null,
      forecastVsBaseline: vsBaseline !== null ? Number(vsBaseline.toFixed(2)) : null,
      hasForecastBaseline: baselineAverage !== null,
      hasBudgets: insights.health.components.some((c) => c.label === BUDGET_ADHERENCE_LABEL),
      categoryDeltaCount: insights.deltas.length,
      largestExpenseCount: insights.largest.length,
    });
  }, [insights]);

  const currency = workspace?.currency ?? "USD";
  const locale = workspace?.locale ?? "en-US";

  if (insights.isLoading) {
    return (
      <AppLayout title="Insights">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      </AppLayout>
    );
  }

  if (!insights.hasTransactions) {
    return (
      <AppLayout title="Insights">
        <BpBox className="stagger-item">
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <Lightbulb className="size-6 text-muted-foreground/40" />
            <p className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground/60">
              No data to analyze yet
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add some transactions and come back — you&apos;ll get a spending forecast, anomaly
              alerts, and a financial health score computed from your history.
            </p>
          </div>
        </BpBox>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Insights">
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ForecastCard forecast={insights.forecast} currency={currency} locale={locale} />
          <HealthScoreCard health={insights.health} />
        </div>
        <AnomalyList anomalies={insights.anomalies} currency={currency} locale={locale} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MomDeltaTable deltas={insights.deltas} currency={currency} locale={locale} />
          <LargestExpenses
            transactions={insights.largest}
            categories={insights.categories}
            currency={currency}
            locale={locale}
          />
        </div>
      </div>
    </AppLayout>
  );
}

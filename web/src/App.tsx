import { useEffect, useState } from "react";
import { saveError, useData } from "./store";
import { TodayView } from "./TodayView";
import { PlanView } from "./PlanView";
import { TasksView } from "./TasksView";
import { CoursesView } from "./CoursesView";
import { MoreView } from "./MoreView";

const TABS = ["Today", "Plan", "Tasks", "Courses", "More"] as const;
type Tab = (typeof TABS)[number];

function initialTab(): Tab {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === "Classes") return "Courses"; // old link
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : "Today";
}

export default function App() {
  const data = useData();
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    history.replaceState(null, "", `#${tab}`);
    window.scrollTo(0, 0);
  }, [tab]);

  return (
    <div className="shell">
      {data.demo && (
        <div className="demo-banner" role="note">
          <strong>DEMO</strong> · made-up example data. Clear it in More.
        </div>
      )}
      {saveError && (
        <p className="banner warn" role="alert">
          {saveError}
        </p>
      )}
      {tab === "Today" && <TodayView go={setTab} />}
      {tab === "Plan" && <PlanView />}
      {tab === "Tasks" && <TasksView />}
      {tab === "Courses" && <CoursesView />}
      {tab === "More" && <MoreView />}
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "tab active" : "tab"} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
    </div>
  );
}

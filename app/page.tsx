import { UI_STRINGS } from "@/lib/i18n";

export default function Home() {
  const strings = UI_STRINGS.en;
  return (
    <div>
      <h1>{strings.appTitle}</h1>
      <p className="muted">{strings.humanUiOnly}</p>
      <div className="card">
        <p>
          <a href="/register">{strings.register}</a>
        </p>
        <p>
          <a href="/tasks">{strings.viewTasks}</a>
        </p>
      </div>
    </div>
  );
}

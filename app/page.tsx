export default function Home() {
  return (
    <div>
      <h1>Call Human MVP</h1>
      <p className="muted">Human UI only. AI calls the API directly.</p>
      <div className="card">
        <p>
          <a href="/register">Register as Human</a>
        </p>
        <p>
          <a href="/tasks">View Tasks</a>
        </p>
      </div>
    </div>
  );
}

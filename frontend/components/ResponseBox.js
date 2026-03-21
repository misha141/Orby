export default function ResponseBox({ response }) {
  const priorityBadge = (level) => {
    const colors = { high: '#e74c3c', medium: '#f39c12', low: '#95a5a6' };
    return (
      <span
        style={{
          background: colors[level] || '#95a5a6',
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: 600,
          marginRight: '6px',
          textTransform: 'uppercase'
        }}
      >
        {level}
      </span>
    );
  };

  return (
    <section className="card">
      <h3>Orby Response</h3>

      {!response && <p>Orby is ready to help!</p>}

      {response && (
        <div>
          <p>{response.message || 'Action complete.'}</p>

          {Array.isArray(response.summary) && response.summary.length > 0 && (
            <ul className="summaryList">
              {response.summary.map((item, idx) => (
                <li key={`${item.from}-${idx}`}>
                  {item.priority && priorityBadge(item.priority)}
                  <strong>{item.from}</strong>: {item.subject} — {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

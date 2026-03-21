export default function ResponseBox({ response }) {
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
                  <strong>{item.from}</strong>: {item.subject} - {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
